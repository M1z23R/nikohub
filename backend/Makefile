APP_NAME := nikohub
BUILD_DIR := ./bin
INSTALL_DIR := /opt/$(APP_NAME)
SERVICE_FILE := $(APP_NAME).service

.PHONY: build test web setup install start stop restart logs status prod

build:
	go build -o $(BUILD_DIR)/$(APP_NAME) ./cmd/server/

test:
	go test ./... -count=1 -race

web:
	cd ../frontend && npm run deploy

setup: build
	@echo "Creating system user..."
	sudo useradd --system --no-create-home --shell /usr/sbin/nologin $(APP_NAME) 2>/dev/null || true
	@echo "Creating installation directory..."
	sudo mkdir -p $(INSTALL_DIR)
	sudo cp $(BUILD_DIR)/$(APP_NAME) $(INSTALL_DIR)/$(APP_NAME)
	sudo chown -R $(APP_NAME):$(APP_NAME) $(INSTALL_DIR)
	@echo "Installing systemd service..."
	sudo cp $(SERVICE_FILE) /etc/systemd/system/$(SERVICE_FILE)
	sudo systemctl daemon-reload
	sudo systemctl enable $(APP_NAME)
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "  1. Create $(INSTALL_DIR)/.env (see .env.example)"
	@echo "  2. Run: sudo systemctl start $(APP_NAME)"

install: build
	@echo "Deploying new binary..."
	sudo systemctl stop $(APP_NAME) || true
	sudo cp $(BUILD_DIR)/$(APP_NAME) $(INSTALL_DIR)/$(APP_NAME)
	sudo chown $(APP_NAME):$(APP_NAME) $(INSTALL_DIR)/$(APP_NAME)
	sudo systemctl start $(APP_NAME)
	@echo "Deployed and restarted."

prod:
	git pull
	$(MAKE) install

start:
	sudo systemctl start $(APP_NAME)

stop:
	sudo systemctl stop $(APP_NAME)

restart:
	sudo systemctl restart $(APP_NAME)

logs:
	sudo journalctl -u $(APP_NAME) -f

status:
	sudo systemctl status $(APP_NAME)
