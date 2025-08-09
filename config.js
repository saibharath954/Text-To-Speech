/* eslint-disable no-undef */
require('dotenv').config();

module.exports = {
  MURF_API_KEY: process.env.MURF_API_KEY,
  VOICE_IDS: {
    Customer: process.env.VOICE_ID_CUSTOMER,
    AI: process.env.VOICE_ID_AI
  },
  SAMPLE_RATE: parseInt(process.env.SAMPLE_RATE) || 24000,
  FORMAT: process.env.FORMAT || 'mp3'
};