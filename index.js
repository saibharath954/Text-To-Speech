/* eslint-disable no-undef */
require('dotenv').config();
const fs = require("fs");
const axios = require("axios");
const { execSync } = require("child_process");
const path = require("path");
const ffprobe = require("ffprobe-static");
const { MURF_API_KEY, VOICE_IDS, SAMPLE_RATE, FORMAT } = require("./config");

const AUDIO_DIR = "audio";
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);

// Get audio duration with ffprobe
function getAudioDuration(filePath) {
  try {
    const cmd = `"${ffprobe.path}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    return parseFloat(execSync(cmd).toString());
  } catch (error) {
    console.error(`Error getting duration for ${filePath}:`, error.message);
    return 0;
  }
}

async function generateTTS(line, index) {
  const voiceId = VOICE_IDS[line.speaker] || VOICE_IDS.Customer;
  console.log(`🎤 Generating voice for line ${index + 1} (${line.speaker})...`);

  try {
    const resp = await axios.post(
      "https://api.murf.ai/v1/speech/generate",
      {
        text: line.text,
        voiceId,
        format: FORMAT,
        sampleRate: SAMPLE_RATE
      },
      {
        headers: {
          "api-key": MURF_API_KEY,
          "Content-Type": "application/json"
        },
        timeout: 30000 // 30 seconds timeout
      }
    );

    const audioUrl = resp.data.audioFile;
    if (!audioUrl) throw new Error(`No audio file returned for line ${index}`);

    const audioResp = await axios.get(audioUrl, { 
      responseType: "arraybuffer",
      timeout: 30000
    });
    
    const rawFilePath = path.join(AUDIO_DIR, `line${index}_raw.mp3`);
    fs.writeFileSync(rawFilePath, audioResp.data);

    const actualDuration = getAudioDuration(rawFilePath);
    const requiredDuration = line.end - line.start;
    
    let finalFilePath;
    if (Math.abs(actualDuration - requiredDuration) > 0.1) {
      const speedFactor = (actualDuration / requiredDuration).toFixed(2);
      finalFilePath = path.join(AUDIO_DIR, `line${index}.mp3`);
      
      console.log(`⏱ Adjusting audio speed (${actualDuration.toFixed(2)}s → ${requiredDuration.toFixed(2)}s, factor: ${speedFactor}x)`);
      execSync(
        `ffmpeg -i "${rawFilePath}" -filter:a "atempo=${speedFactor}" -q:a 2 "${finalFilePath}" -y`
      );
      fs.unlinkSync(rawFilePath);
    } else {
      finalFilePath = rawFilePath;
    }

    return finalFilePath;
  } catch (error) {
    console.error(`❌ Error generating TTS for line ${index}:`, error.message);
    throw error;
  }
}

function createSilenceFile(duration, index) {
  const silencePath = path.join(AUDIO_DIR, `silence${index}.mp3`);
  try {
    execSync(
      `ffmpeg -f lavfi -i anullsrc=r=${SAMPLE_RATE}:cl=mono -t ${duration} -q:a 9 -acodec libmp3lame "${silencePath}" -y`
    );
    return silencePath;
  } catch (error) {
    console.error(`❌ Error creating silence file:`, error.message);
    throw error;
  }
}

function getVideoDuration() {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.mp4`;
  return parseFloat(execSync(cmd).toString());
}

async function main() {
  try {
    const script = require("./script_with_duration.json");
    const videoDuration = getVideoDuration();
    let listFileContent = "";
    let lastEnd = 0;

    // Generate all audio + silences
    for (let i = 0; i < script.length; i++) {
      const line = script[i];
      const gap = line.start - lastEnd;
      
      if (gap > 0) {
        const silenceFile = createSilenceFile(gap, i);
        listFileContent += `file '${silenceFile}'\n`;
      }

      const speechFile = await generateTTS(line, i);
      listFileContent += `file '${speechFile}'\n`;
      lastEnd = line.end;
    }

    // Add final silence if needed
    const finalGap = videoDuration - lastEnd;
    if (finalGap > 0) {
      const silenceFile = createSilenceFile(finalGap, "final");
      listFileContent += `file '${silenceFile}'\n`;
    }

    fs.writeFileSync("audio_list.txt", listFileContent);

    // Concatenate audio
    console.log("🎼 Concatenating audio segments...");
    execSync(
      `ffmpeg -f concat -safe 0 -i audio_list.txt -c copy final_audio.mp3 -y`
    );

    // Merge with video
    console.log("🎬 Merging with video...");
    execSync(
        `ffmpeg -i video.mp4 -i final_audio.mp3 -c:v copy ` +
        `-filter_complex "apad=whole_dur=${videoDuration}" ` +
        `-map 0:v:0 -map 1:a:0 -shortest final_video.mp4 -y`
    );
    console.log("✅ Done! final_video.mp4 created.");
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    process.exit(1);
  }
}

main();