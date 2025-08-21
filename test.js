require('dotenv').config();
const Database = require('./src/database');
const AIClient = require('./src/ai-client');

async function test() {
  console.log('Testing database...');
  const db = new Database();
  
  console.log('Testing AI client...');
  const aiClient = new AIClient();
  
  try {
    const challenge = await aiClient.generateChallenge('easy');
    console.log('Generated challenge:', challenge);
    
    const id = await db.saveChallenge(challenge);
    console.log('Saved challenge with ID:', id);
    
    const next = await db.getNextChallenge();
    console.log('Next challenge:', next);
    
    console.log('All tests passed!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

test();