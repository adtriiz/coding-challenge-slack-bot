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

        // Validate required fields
        if (!data || !data.title || !data.content || !data.url) {
          console.warn(`Attempt ${attempt + 1}: Invalid problem data for ID ${randomId}`);
          continue; // try again with another ID
        }

        // Only return challenge if difficulty matches (case-insensitive)
        if (difficulty && data.difficulty && data.difficulty.toLowerCase() !== difficulty.toLowerCase()) {
          continue;
        }

        const challenge = {
          title: data.title,
          description: this.stripHtml(data.content),
          example: 'See Leetcode page for examples.',
          function_stub: `// Solve at: ${data.url}`,
          difficulty: data.difficulty ? data.difficulty.toLowerCase() : 'medium',
          url: data.url
        };

        return challenge;
      } catch (err) {
        console.warn(`Attempt ${attempt + 1}: Fetch failed for ID ${randomId}:`, err.message);
      }
    }

    // If all retries fail, return fallback
    console.error('Failed to fetch a valid challenge after multiple attempts.');
    return this.getFallbackChallenge(difficulty);
  }

  stripHtml(html) {
    const stripped = html.replace(/<[^>]*>/g, '');
    return he.decode(stripped).trim();
  }

  getFallbackChallenge(difficulty) {
    const fallbacks = {
      easy: {
        title: 'Add Numbers',
        description: 'Write a function that adds two numbers.',
        example: 'Input: add(2, 3) → Output: 5',
        function_stub: 'function add(a, b) { return a + b; }',
        difficulty,
        url: ''
      },
      medium: {
        title: 'Reverse a String',
        description: 'Reverse a string without using built-in reverse methods.',
        example: 'Input: "hello" → Output: "olleh"',
        function_stub: 'function reverse(str) { /* your code */ }',
        difficulty,
        url: ''
      },
      hard: {
        title: 'Palindrome Checker',
        description: 'Check if a string is a palindrome.',
        example: 'Input: "racecar" → Output: true',
        function_stub: 'function isPalindrome(s) { /* your code */ }',
        difficulty,
        url: ''
      }
    };

    return fallbacks[difficulty] || fallbacks.medium;
  }
}

module.exports = AIClient;