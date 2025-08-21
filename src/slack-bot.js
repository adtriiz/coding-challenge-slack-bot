const { App } = require('@slack/bolt');
const Database = require('./database');
const AIClient = require('./ai-client');

class SlackBot {
  constructor() {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET
    });
    
    this.db = new Database();
    this.aiClient = new AIClient();
    this.setupCommands();
  }

	setupCommands() {
	  // Generate challenge (via Leetcode API)
	  this.app.command('/generate', async ({ command, ack, respond }) => {
	    await ack();
	
	    try {
	      const difficulty = command.text.trim() || 'medium'; // Optional argument
	
	      await respond(`🎲 Fetching a random challenge...`);
	
	      const challenge = await this.aiClient.generateChallenge(difficulty);
	      const id = await this.db.saveChallenge(challenge);
	
	      await respond(`✅ Added *${challenge.title}* (${challenge.difficulty}) to queue with ID ${id}.`);
	    } catch (error) {
	      console.error('Generate command failed:', error);
	      await respond('❌ Failed to generate challenge. Please try again.');
	    }
	  });
	
	  // Post next approved challenge
	  this.app.command('/post', async ({ command, ack, respond }) => {
	    await ack();
	
	    try {
	      const challenge = await this.db.getNextChallenge();
	
	      if (!challenge) {
	        await respond('🚫 No approved challenges available. Use `/approve <id>` first.');
	        return;
	      }
	
	      const result = await this.postChallenge(challenge);
	      await respond(`✅ Posted: *${challenge.title}*`);
	    } catch (error) {
	      console.error('Post command failed:', error);
	      await respond('❌ Failed to post challenge.');
	    }
	  });
	
	  // Check challenge queue status
	  this.app.command('/queuestatus', async ({ command, ack, respond }) => {
	    await ack();
	
	    try {
	      const count = await this.db.getQueueStatus();
	      await respond(`📊 Queue status: ${count} approved challenge(s) ready to post.`);
	    } catch (error) {
	      console.error('Status command failed:', error);
	      await respond('❌ Failed to retrieve queue status.');
	    }
	  });
	
	  // Show full queue of pending/approved challenges
	  this.app.command('/queue', async ({ command, ack, respond }) => {
	    await ack();
	
	    try {
	      const list = await this.db.getChallengeQueue();
	
	      if (list.length === 0) {
	        await respond('📭 The challenge queue is empty.');
	        return;
	      }
	
	      const text = list.map(c =>
	        `• *${c.id}: ${c.title}* (${c.difficulty}) – _${c.status}_ – position: ${c.position ?? '—'}`
	      ).join('\n');
	
	      await respond(`📋 *Challenge Queue:*\n${text}`);
	    } catch (err) {
	      console.error('Queue command failed:', err);
	      await respond('❌ Failed to fetch queue.');
	    }
	  });
	
	  // Approve challenge by ID
	  this.app.command('/approve', async ({ command, ack, respond }) => {
	    await ack();
	
	    const id = parseInt(command.text.trim(), 10);
	    if (isNaN(id)) {
	      await respond('⚠️ Usage: `/approve <challenge_id>`');
	      return;
	    }
	
	    try {
	      await this.db.approveChallenge(id);
	      await respond(`✅ Challenge ${id} approved and ready for posting.`);
	    } catch (err) {
	      console.error('Approve command failed:', err);
	      await respond('❌ Failed to approve challenge.');
	    }
		
		const postAtUnix = Math.floor(new Date(targetDateTime).getTime() / 1000);

		await this.app.client.chat.scheduleMessage({
			token: process.env.SLACK_BOT_TOKEN,
			channel: process.env.SLACK_CHALLENGES_CHANNEL,
			text: this.formatChallenge(challenge),
			post_at: postAtUnix
		});
	  });
	
	  // Reorder challenge in queue
	  this.app.command('/reorder', async ({ command, ack, respond }) => {
	    await ack();
	
	    const [idStr, posStr] = command.text.trim().split(/\s+/);
	    const id = parseInt(idStr, 10);
	    const position = parseInt(posStr, 10);
	
	    if (isNaN(id) || isNaN(position)) {
	      await respond('⚠️ Usage: `/reorder <challenge_id> <position>`');
	      return;
	    }
	
	    try {
	      await this.db.reorderChallenge(id, position);
	      await respond(`✅ Challenge ${id} moved to position ${position}.`);
	    } catch (err) {
	      console.error('Reorder command failed:', err);
	      await respond('❌ Failed to reorder challenge.');
	    }
	  });
	
	  // Remove challenge from queue
	  this.app.command('/delete', async ({ command, ack, respond }) => {
	    await ack();
	
	    const id = parseInt(command.text.trim(), 10);
	    if (isNaN(id)) {
	      await respond('⚠️ Usage: `/delete <challenge_id>`');
	      return;
	    }
	
	    try {
	      await this.db.removeChallenge(id);
	      await respond(`🗑️ Challenge ${id} removed from queue.`);
	    } catch (err) {
	      console.error('Remove command failed:', err);
	      await respond('❌ Failed to remove challenge.');
	    }
	  });
	
	  // Preview challenge by ID
	  this.app.command('/preview', async ({ command, ack, respond }) => {
	    await ack();
	
	    const id = parseInt(command.text.trim(), 10);
	    if (isNaN(id)) {
	      await respond('⚠️ Usage: `/preview <challenge_id>`');
	      return;
	    }
	
	    try {
	      const challenge = await this.db.getChallengeById(id);
	
	      if (!challenge) {
	        await respond(`❓ No challenge found with ID ${id}`);
	        return;
	      }
	
	      const text = `
		🧩 *[${challenge.difficulty.toUpperCase()}]* *${challenge.title}*
		
		${challenge.description}
		
		*Example:*
		${challenge.example}
		
		*Function to complete:*
		\`\`\`javascript
		${challenge.function_stub}
		\`\`\`
		
		<${challenge.url}|🔗 View on Leetcode>
		
		_Status: ${challenge.status} • Position: ${challenge.position ?? '—'}_
		      `.trim();
		
		      await respond({ text });
		    } catch (err) {
		      console.error('Preview command failed:', err);
		      await respond('❌ Failed to preview challenge.');
		    }
		  });
	}


  async postChallenge(challenge) {
    const challengeText = this.formatChallenge(challenge);
    
    const result = await this.app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: process.env.SLACK_CHALLENGES_CHANNEL,
      text: challengeText,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: challengeText
          }
        }
      ]
    });

    // Mark as used
    await this.db.markAsUsed(challenge.id, result.ts);
    
    return result;
  }

  formatChallenge(challenge) {
    return `
🧩 **Weekly Coding Challenge** - ${challenge.difficulty.toUpperCase()}

**${challenge.title}**

${challenge.description}

**Example:**
${challenge.example}

**Function to complete:**
\`\`\`javascript
${challenge.function_stub}
\`\`\`

**Leetcode Link:** <${challenge.url}>

Reply in this thread with your solution! 🚀
    `.trim();
  }

  async start() {
    await this.app.start(process.env.PORT || 3000);
    console.log('⚡️ Slack bot is running!');
  }
}

module.exports = SlackBot;