const axios = require('axios');
const he = require('he');

class AIClient {
  constructor() {
    this.baseUrl = 'https://leetcode-api-pied.vercel.app';
    this.maxRetries = 5;
  }

  async generateChallenge() {
    const maxId = 3000;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const randomId = Math.floor(Math.random() * maxId) + 1;
      try {
        const res = await axios.get(`${this.baseUrl}/problem/${randomId}`);
        const data = res.data;
        if (!data || !data.title || !data.content) continue;
        return {
          title: data.title,
          description: this.stripHtml(data.content),
          example: 'See LeetCode page for examples.',
          function_stub: `// Solve at: ${data.url}`,
          difficulty: (data.difficulty || 'medium').toLowerCase(),
          url: data.url || ''
        };
      } catch {
        /* try next */
      }
    }
    return this.getFallbackChallenge('medium');
  }

  stripHtml(html) {
    const stripped = html.replace(/<[^>]*>/g, '');
    return he.decode(stripped).trim();
  }

  getFallbackChallenge(difficulty) {
    const fallbacks = {
      easy: {
        title: 'Two Sum Lite',
        description: 'Return indices of two numbers adding to target.',
        example: 'Input: nums=[2,7,11,15], target=9 → Output: [0,1]',
        function_stub: 'function twoSum(nums, target) { /* your code */ }',
        difficulty,
        url: ''
      },
      medium: {
        title: 'Reverse a String',
        description: 'Reverse a string without using built-in reverse.',
        example: 'Input: "hello" → Output: "olleh"',
        function_stub: 'function reverse(str) { /* your code */ }',
        difficulty,
        url: ''
      },
      hard: {
        title: 'Palindrome Checker',
        description: 'Check if a string is a palindrome ignoring punctuation.',
        example: 'Input: "A man, a plan, a canal: Panama" → true',
        function_stub: 'function isPalindrome(s) { /* your code */ }',
        difficulty,
        url: ''
      }
    };
    return fallbacks[difficulty] || fallbacks.medium;
  }
}

module.exports = AIClient;