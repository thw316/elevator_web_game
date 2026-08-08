FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Install serve globally
RUN npm install -g serve

# Expose the default serve port
EXPOSE 3000

# Run serve
CMD ["serve", "-s", ".", "-l", "3000"]
