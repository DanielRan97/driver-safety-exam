// Cloudflare Pages "Advanced Mode" entry point. This exists ONLY so the
// app can also be reached via a *.pages.dev URL (a different shared
// Cloudflare subdomain than *.workers.dev) as a workaround for networks
// that block/fail to resolve workers.dev specifically. It's a thin
// re-export — all real logic lives in worker/index.js, which is what the
// normal Workers deployment (wrangler.jsonc) also uses.
export { default } from '../worker/index.js';
