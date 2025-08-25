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
			await respond(`🎲 Fetching a random challenge...`);

			// Do the slow work asynchronously
			(async () => {
				try {
					const difficulty = command.text.trim() || 'medium';
					const challenge = await this.aiClient.generateChallenge(difficulty);
					const id = await this.db.saveChallenge(challenge);

					// Send follow-up message to the user/channel
					await this.app.client.chat.postMessage({
						channel: command.channel_id,
						text: `✅ Added *${challenge.title}* (${challenge.difficulty}) to queue with ID ${id}.`,
					});
				} catch (error) {
					console.error('Generate command failed:', error);
					await this.app.client.chat.postMessage({
						channel: command.channel_id,
						text: '❌ Failed to generate challenge. Please try again.',
					});
				}
			})();
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
					const args = command.text.trim().split(/\s+/);
					const id = parseInt(args[0], 10);

					if (isNaN(id)) {
						await respond('⚠️ Usage: `/approve <challenge_id>`');
						return;
					}

					try {
						await this.db.approveChallenge(id);

						// Get all scheduled_at values (ISO strings)
						const scheduledList = await new Promise((resolve, reject) => {
							this.db.all(
								'SELECT scheduled_at FROM challenges WHERE scheduled_at IS NOT NULL',
								(err, rows) => {
									if (err) reject(err);
									else resolve(rows.map(r => r.scheduled_at));
								}
							);
						});

						// Helper: get next available Tuesday 9:00
						function getNextFreeTuesday(scheduledList) {
							const now = new Date();
							let candidate = new Date(now);
							candidate.setHours(9, 0, 0, 0);
							// Find next Tuesday
							candidate.setDate(candidate.getDate() + ((9 - candidate.getDay()) % 7 || 7));
							// If today is Tuesday and before 9:00, use today
							if (now.getDay() === 2 && now.getHours() < 9) {
								candidate = new Date(now);
								candidate.setHours(9, 0, 0, 0);
							}
							// Loop until we find a free slot
							while (scheduledList.includes(candidate.toISOString())) {
								candidate.setDate(candidate.getDate() + 7);
							}
							return candidate;
						}

						const nextTuesday = getNextFreeTuesday(scheduledList);

						// Update challenge with scheduled_at
						await new Promise((resolve, reject) => {
							this.db.run(
								'UPDATE challenges SET scheduled_at = ? WHERE id = ?',
								[nextTuesday.toISOString(), id],
								err => (err ? reject(err) : resolve())
							);
						});

						// Get challenge details
						const challenge = await this.db.getChallengeById(id);
						if (!challenge) {
							await respond(`⚠️ Challenge ${id} not found.`);
							return;
						}
						const postAtUnix = Math.floor(nextTuesday.getTime() / 1000);
						await this.app.client.chat.scheduleMessage({
							token: process.env.SLACK_BOT_TOKEN,
							channel: process.env.SLACK_CHALLENGES_CHANNEL,
							text: this.formatChallenge(challenge),
							post_at: postAtUnix
						});
						await respond(`✅ Challenge ${id} approved and scheduled for posting at ${nextTuesday.toLocaleString()}.`);
					} catch (err) {
						console.error('Approve command failed:', err);
						await respond('❌ Failed to approve challenge.');
					}
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