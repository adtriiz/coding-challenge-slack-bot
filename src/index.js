require('dotenv').config();
const SlackBot = require('./slack-bot');

async function main() {
  try {
    const bot = new SlackBot();
    await bot.start();
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();