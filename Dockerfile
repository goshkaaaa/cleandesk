FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
