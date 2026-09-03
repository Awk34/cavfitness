ARG APP_DIR="/app"
ARG DATA_DIR="/app/data"

FROM node:bookworm-slim AS build-image

# Include global arg in this stage of the build
ARG APP_DIR
ARG DATA_DIR

# Install build & browser dependencies first (cached across builds)
RUN apt update && \
    apt install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libnss3 libnss3-dev \
    libnspr4 libnspr4-dev \
    libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libappindicator3-1 \
    libc6 \
    libcairo2 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 \
    libxcursor1 \
    libxext6 \
    libxi6 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils && \
    rm -rf /var/lib/apt/lists/*

VOLUME ${DATA_DIR}
RUN mkdir -p ${DATA_DIR}

# Copy app code
RUN mkdir -p ${APP_DIR}
COPY ./dist ${APP_DIR}

WORKDIR ${APP_DIR}

RUN npm install -g pnpm@11.24.0
RUN pnpm install --prod --frozen-lockfile

# Ensure browser is cleanly installed
RUN rm -rf /root/.cache/puppeteer && pnpm exec puppeteer browsers install chrome

# Set runtime interface client as default command for the container runtime
ENTRYPOINT ["node", "index.js"]
