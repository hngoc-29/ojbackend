FROM node:20-slim

# Cài g++ và các gói cần thiết
RUN apt update && apt install -y g++ build-essential

# Làm việc như bình thường
WORKDIR /app
COPY . .
RUN npm install

CMD ["npm", "start"]
