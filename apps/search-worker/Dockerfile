FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Search worker doesn't need to expose ports, it just runs as a worker daemon

CMD ["npm", "start"]
