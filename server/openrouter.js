import OpenAI from 'openai';

const client = new OpenAI({
  apiKey:  process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://kmbytv.github.io/icarus/',
    'X-Title':      'KAI Agent',
  },
});

export default client;
