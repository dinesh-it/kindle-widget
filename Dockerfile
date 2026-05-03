FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js server.js config.js quotes.js ./

ENV PORT=8181
ENV HOST=0.0.0.0

EXPOSE 8181

CMD ["node", "server.js"]
