/**
 * Every 10 minutes: bring new Discord posts into the Ideation Machine
 * (outlier channels → outliers, #rough-ideas → video ideas). Does nothing until the bot is connected on the page.
 */
import { syncDiscord } from '../lib/ideation-discord.mjs';

export default async function handler() {
  const r = await syncDiscord({ budgetMs: 24000 });
  console.log('ideation-discord', JSON.stringify({ configured: r.configured, busy: r.busy || false, added: (r.added || []).length, more: r.more || false, errors: r.errors || [] }));
  return new Response('ok');
}

export const config = { schedule: '*/10 * * * *' };
