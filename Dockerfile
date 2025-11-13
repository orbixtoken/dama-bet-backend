FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Instala dependências do sistema se necessário (ex.: pg-native)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3001
CMD ["node", "server.js"]
