FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 LYRICS_DB_PATH=/var/lib/sps-lyrics/lyrics.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY *.mjs ./
COPY public ./public
COPY scripts ./scripts
COPY data/store.json ./data/store.json
RUN mkdir -p /var/lib/sps-lyrics && chown node:node /var/lib/sps-lyrics
USER node
EXPOSE 8787
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(async r=>{if(!r.ok || !(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
