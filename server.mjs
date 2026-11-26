// Production server for big-vps (Coolify): serves the Vite build in dist/ and the
// contact form endpoint POST /api/send-email (the same handler api/send-email.ts
// ran on Vercel; a static host has no /api, so the form returned 404).
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { Resend } from 'resend';

const PORT = Number(process.env.PORT || 3000);
const DIST = join(process.cwd(), 'dist');
const resend = new Resend(process.env.RESEND_API_KEY);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function sendEmail(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'Invalid request' }); }
  const { name, email, subject, message } = body || {};
  if (!name || !email || !subject || !message) return sendJson(res, 400, { error: 'All fields are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return sendJson(res, 400, { error: 'Please enter a valid email address' });
  try {
    const { data, error } = await resend.emails.send({
      from: 'Luxury Sensation Massage <noreply@luxurysensationmassage.com>',
      to: ['luxurysensationmassage@gmail.com'],
      replyTo: String(email),
      subject: `[Contact Form] ${String(subject).replace(/[\r\n]+/g, ' ').slice(0, 200)}`,
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 600px; margin: 0 auto; background: #fff;">
          <div style="background: linear-gradient(135deg, #D4A5A5, #E8C4C4); padding: 30px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 24px;">New Contact Form Message</h1>
          </div>
          <div style="padding: 30px; background: #fafafa;">
            <div style="background: #fff; border-radius: 16px; padding: 24px;">
              <h2 style="color: #D4A5A5; margin-top: 0; font-size: 18px; border-bottom: 2px solid #E8C4C4; padding-bottom: 10px;">Client Details</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 12px 0; color: #888; font-size: 12px; text-transform: uppercase; width: 100px;">Name</td><td style="padding: 12px 0; color: #333;">${escapeHtml(name)}</td></tr>
                <tr><td style="padding: 12px 0; color: #888; font-size: 12px; text-transform: uppercase;">Email</td><td style="padding: 12px 0; color: #333;"><a href="mailto:${escapeHtml(email)}" style="color: #D4A5A5;">${escapeHtml(email)}</a></td></tr>
                <tr><td style="padding: 12px 0; color: #888; font-size: 12px; text-transform: uppercase;">Subject</td><td style="padding: 12px 0; color: #333;">${escapeHtml(subject)}</td></tr>
              </table>
              <h3 style="color: #D4A5A5; margin-top: 24px; font-size: 14px; text-transform: uppercase;">Message</h3>
              <div style="background: #f9f9f9; border-left: 4px solid #D4A5A5; padding: 16px; color: #555; line-height: 1.6;">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
            </div>
            <p style="text-align: center; color: #999; font-size: 12px; margin-top: 24px;">Sent from the contact form on <a href="https://www.luxurysensationmassage.com" style="color: #D4A5A5;">luxurysensationmassage.com</a></p>
          </div>
        </div>`,
    });
    if (error) { console.error('Resend error:', error); return sendJson(res, 500, { error: 'Failed to send email' }); }
    return sendJson(res, 200, { success: true, messageId: data?.id });
  } catch (err) {
    console.error('Server error:', err);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
}

function serveFile(req, res, path) {
  let st;
  try { st = statSync(path); } catch { return false; }
  if (!st.isFile()) return false;
  const type = TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
  const hashed = path.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': type, 'Content-Length': st.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : (type.startsWith('text/html') ? 'no-cache' : 'public, max-age=86400'),
  });
  if (req.method === 'HEAD') return res.end(), true;
  createReadStream(path).pipe(res);
  return true;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/send-email') {
    if (req.method === 'OPTIONS') { res.writeHead(204, { Allow: 'POST, OPTIONS' }); return res.end(); }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    return sendEmail(req, res);
  }
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
  let p; try { p = decodeURIComponent(url.pathname); } catch { p = '/'; }
  const file = normalize(join(DIST, p));
  if (!file.startsWith(DIST)) { res.writeHead(400); return res.end(); }
  if (serveFile(req, res, p.endsWith('/') ? join(file, 'index.html') : file)) return;
  if (!extname(p) && serveFile(req, res, join(DIST, 'index.html'))) return;   // SPA fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
}).listen(PORT, '0.0.0.0', () => console.log(`listening on ${PORT}`));
