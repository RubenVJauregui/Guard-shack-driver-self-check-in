FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p identity-records
EXPOSE 4178
ENV PORT=4178
ENV HOST=0.0.0.0
CMD ["node", "server.js"]

# build-bust-lincoln-1783456110
