'use strict';

const http = require('http');
const net = require('net');
const readline = require('readline');
const {chromium} = require('playwright');

const connections = new Map();
let sequence = 0;
let origin;
let browser;

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function openTunnel(socket, hostname, port, firstData, isConnect) {
  const id = String(++sequence);
  connections.set(id, {socket, firstData, isConnect});
  socket.pause();
  socket.on('data', data => send({type:'data', id, data:data.toString('base64')}));
  socket.on('close', () => {connections.delete(id); send({type:'close', id});});
  socket.on('error', () => socket.destroy());
  send({type:'open', id, host:hostname, port:Number(port)});
}

const proxy = http.createServer((request, response) => {
  let url;
  try { url = new URL(request.url); } catch { response.writeHead(400); response.end(); return; }
  if (!['GET', 'HEAD'].includes(request.method) || url.protocol !== 'http:') {
    response.writeHead(403); response.end(); return;
  }
  const headers = {...request.headers};
  delete headers['proxy-connection'];
  headers.connection = 'close';
  const first = request.method + ' ' + (url.pathname || '/') + url.search + ' HTTP/1.1\r\n'
    + Object.entries(headers).map(([name,value]) => name + ': ' + value).join('\r\n') + '\r\n\r\n';
  openTunnel(request.socket, url.hostname, url.port || 80, Buffer.from(first), false);
});

proxy.on('connect', (request, socket, head) => {
  let target;
  try { target = new URL('http://' + request.url); } catch { socket.destroy(); return; }
  openTunnel(socket, target.hostname, target.port || 443, head, true);
});

readline.createInterface({input:process.stdin, crlfDelay:Infinity}).on('line', async line => {
  let message;
  try { message = JSON.parse(line); } catch { process.exit(1); }
  if (message.type === 'init') {
    try {
      origin = new URL(message.url);
      await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({headless:true, args:[
        '--no-sandbox', '--disable-quic', '--disable-dev-shm-usage',
        '--proxy-server=http://127.0.0.1:' + proxy.address().port,
        '--proxy-bypass-list=<-loopback>'
      ]});
      const context = await browser.newContext({viewport:{width:1280,height:800}, serviceWorkers:'block'});
      await context.route('**/*', route => {
        let url;
        try { url = new URL(route.request().url()); } catch { return route.abort(); }
        const ports = new Set(['', '80', '443', origin.port]);
        if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== origin.hostname
            || !ports.has(url.port) || !['GET', 'HEAD'].includes(route.request().method())) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      const result = await page.goto(origin.href, {waitUntil:'domcontentloaded', timeout:20000});
      if (!result || result.status() >= 400) throw new Error('Live-URL antwortete mit HTTP ' + (result ? result.status() : 'unbekannt'));
      await page.waitForTimeout(1200);
      const image = await page.screenshot({type:'png', timeout:10000});
      send({type:'done', data:image.toString('base64')});
    } catch (error) {
      send({type:'error', error:String(error.message || error).slice(0,300)});
    } finally {
      if (browser) await browser.close();
      proxy.close();
      process.exit(0);
    }
    return;
  }
  const entry = connections.get(message.id);
  if (!entry) return;
  if (message.type === 'opened') {
    if (entry.isConnect) entry.socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (entry.firstData.length) {
      send({type:'data', id:message.id, data:entry.firstData.toString('base64')});
    }
    entry.socket.resume();
  } else if (message.type === 'data') {
    entry.socket.write(Buffer.from(message.data, 'base64'));
  } else if (message.type === 'close') {
    entry.socket.destroy();
  }
});
