# Use uma imagem leve do Node
FROM node:20-alpine

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante do código
COPY . .

# Expõe a porta que sua API usa
EXPOSE 3001

# Comando para rodar a aplicação
CMD ["npm", "start"]