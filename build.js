#!/usr/bin/env node
// Builds dist/poker.html: index.html with every stylesheet and script inlined,
// so the whole game is one file you can share or open by double-click.
// Usage: node build.js
const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const html = read('index.html')
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, p) => '<style>' + read(p) + '</style>')
  .replace(/<script src="([^"]+)"><\/script>/g, (m, p) => '<script>' + read(p) + '</script>');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'poker.html'), html);
console.log('Built dist/poker.html (' + Math.round(Buffer.byteLength(html) / 1024) + ' KB)');
