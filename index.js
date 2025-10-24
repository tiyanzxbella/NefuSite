require('dotenv').config();
const express = require('express');
const { formidable } = require('formidable');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const app = express();
const port = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = process.env.GITHUB_USER;
const CDN_REPO = process.env.CDN_REPO;
const GIST_ID = process.env.GIST_ID;
const APP_DOMAIN = process.env.APP_DOMAIN;

const githubApi = axios.create({
  baseURL: 'https://api.github.com',
  headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function generateRandomCode(length = 4) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

app.get('/', (req, res) => {
  res.render('index', { config });
});

app.post('/upload', async (req, res) => {
  const form = formidable({});
  form.parse(req, async (err, fields, files) => {
    if (err || !files.file || !files.file[0]) {
      return res.status(400).json({ error: 'File upload failed.' });
    }
    const file = files.file[0];
    const fileExtension = path.extname(file.originalFilename);
    const fileContent = fs.readFileSync(file.filepath).toString('base64');
    let uniqueCode = generateRandomCode();
    let fileName = `${uniqueCode}${fileExtension}`;
    try {
      await githubApi.put(`/repos/${GITHUB_USER}/${CDN_REPO}/contents/${fileName}`, {
        message: `upload: ${fileName}`, content: fileContent,
      });
      res.json({ url: `${APP_DOMAIN}/${fileName}` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upload file.' });
    }
  });
});

app.post('/shorten', async (req, res) => {
  const { longUrl, customCode } = req.body;
  if (!longUrl) return res.status(400).json({ error: 'URL is required.' });
  try {
    const { data: gist } = await githubApi.get(`/gists/${GIST_ID}`);
    const gistFile = Object.values(gist.files)[0];
    let links = JSON.parse(gistFile.content || '{}');
    let shortCode = customCode;
    if (!shortCode) {
      do { shortCode = generateRandomCode(); } while (links[shortCode]);
    } else if (links[shortCode]) {
      return res.status(400).json({ error: 'Custom code already in use.' });
    }
    links[shortCode] = longUrl;
    await githubApi.patch(`/gists/${GIST_ID}`, {
      files: { [gistFile.filename]: { content: JSON.stringify(links, null, 2) } },
    });
    res.json({ url: `${APP_DOMAIN}/${shortCode}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to shorten URL.' });
  }
});

app.get('/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const { data: gist } = await githubApi.get(`/gists/${GIST_ID}`);
    const gistFile = Object.values(gist.files)[0];
    const links = JSON.parse(gistFile.content || '{}');
    if (links[code]) {
      return res.redirect(302, links[code]);
    }
  } catch (error) { /* Gist fetch failed, continue to CDN */ }

  try {
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${CDN_REPO}/main/${code}`;
    const response = await axios({ method: 'get', url: rawUrl, responseType: 'stream' });
    res.setHeader('Content-Type', response.headers['content-type']);
    res.setHeader('Content-Length', response.headers['content-length']);
    response.data.pipe(res);
  } catch (error) {
    res.status(404).render('404');
  }
});

app.listen(port, () => {
  console.log(`Server running at ${APP_DOMAIN}`);
});
