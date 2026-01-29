# -------------------------
# Этап 1: Сборка приложения
# -------------------------
FROM node:18-alpine AS builder

WORKDIR /app

# Копируем файлы package.json и package-lock.json
COPY package*.json ./

# Устанавливаем все зависимости, включая devDependencies для сборки
RUN npm install

# Копируем исходный код и конфигурацию TypeScript
COPY src ./src
COPY tsconfig.json ./

# Собираем TypeScript в JavaScript
RUN npm run build

# ------------------------------------------
# Этап 2: Создание чистого production-образа
# ------------------------------------------
FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем только production-зависимости
RUN npm ci --only=production

# Копируем скомпилированный код из этапа сборки
COPY --from=builder /app/dist ./dist

# Копируем .env.example, чтобы можно было создать .env на его основе
COPY .env.example .

# Команда для запуска приложения
CMD ["npm", "run", "serve"]
