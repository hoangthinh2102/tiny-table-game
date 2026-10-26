# Tiny Tumble: one small Node process serves the client and runs every match in memory
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js bots.js ./
COPY shared ./shared
COPY client ./client
USER node
EXPOSE 8080
CMD ["node", "server.js"]
