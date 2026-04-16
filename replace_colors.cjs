const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.css')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('src');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('yellow-400')) {
    content = content.replace(/yellow-400/g, '[#ccff00]');
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated ' + file);
  }
  if (content.includes('yellow-500')) {
    content = content.replace(/yellow-500/g, '[#aacc00]');
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated ' + file);
  }
  if (content.includes('yellow-600')) {
    content = content.replace(/yellow-600/g, '[#88aa00]');
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated ' + file);
  }
});
