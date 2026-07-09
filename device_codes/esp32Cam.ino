#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

#define FLASH_LED_PIN 4

#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27

#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5

#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

HardwareSerial DevKitSerial(1);

const int CAM_RX_PIN = 14;
const int CAM_TX_PIN = 13;

const unsigned long USB_BAUD = 115200;
const unsigned long LINK_BAUD = 9600;

const char *AP_SSID = "RobotCar-CAM";
const char *AP_PASSWORD = "robot1234";

httpd_handle_t cameraHttpd = NULL;
httpd_handle_t streamHttpd = NULL;

char devkitLine[100];
byte devkitLineIndex = 0;

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Robot Car Control</title>

  <style>
    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      touch-action: none;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #000;
      color: white;
      font-family: Arial, Helvetica, sans-serif;
      overflow: hidden;
    }

    .screen {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #000;
    }

    .video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #000;
    }

    .shade {
      position: absolute;
      inset: 0;
      background: linear-gradient(to bottom, rgba(0,0,0,0.55), transparent 22%, transparent 74%, rgba(0,0,0,0.55));
      pointer-events: none;
    }

    .brand {
      position: absolute;
      top: calc(env(safe-area-inset-top, 0px) + 10px);
      left: calc(env(safe-area-inset-left, 0px) + 10px);
      z-index: 10;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(0,0,0,0.48);
      border: 1px solid rgba(255,255,255,0.18);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }

    .status {
      position: absolute;
      top: calc(env(safe-area-inset-top, 0px) + 44px);
      left: calc(env(safe-area-inset-left, 0px) + 10px);
      z-index: 10;
      padding: 6px 9px;
      border-radius: 999px;
      background: rgba(0,0,0,0.42);
      border: 1px solid rgba(255,255,255,0.14);
      color: #90ffbf;
      font-size: 11px;
      font-weight: 800;
    }

    .top-actions {
      position: absolute;
      top: calc(env(safe-area-inset-top, 0px) + 10px);
      right: calc(env(safe-area-inset-right, 0px) + 10px);
      z-index: 12;
      display: flex;
      gap: 7px;
    }

    .hud-btn {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(0,0,0,0.46);
      color: white;
      font-size: 11px;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .hud-btn:active,
    .hud-btn.active {
      background: rgba(0, 200, 255, 0.55);
      transform: scale(0.95);
    }

    .manual-btn {
      position: absolute;
      left: 50%;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
      transform: translateX(-50%);
      z-index: 12;
      min-width: 190px;
      height: 48px;
      padding: 0 18px;
      border: 1px solid rgba(255,255,255,0.22);
      border-radius: 999px;
      background: rgba(0,0,0,0.58);
      color: white;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0.4px;
    }

    .manual-btn:active {
      background: rgba(0, 200, 255, 0.55);
      transform: translateX(-50%) scale(0.97);
    }

    .controls {
      position: absolute;
      inset: 0;
      z-index: 11;
      display: none;
      pointer-events: none;
    }

    .controls.show {
      display: block;
    }

    .left-cluster {
      position: absolute;
      left: calc(env(safe-area-inset-left, 0px) + 14px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 32px);
      display: flex;
      gap: 10px;
      pointer-events: auto;
    }

    .right-cluster {
      position: absolute;
      right: calc(env(safe-area-inset-right, 0px) + 14px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 22px);
      display: grid;
      grid-template-columns: 54px;
      grid-template-rows: 54px 54px 54px;
      gap: 8px;
      pointer-events: auto;
    }

    .ctrl {
      width: 54px;
      height: 54px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.20);
      background: rgba(0,0,0,0.46);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ctrl:active,
    .ctrl.active {
      background: rgba(0, 200, 255, 0.58);
      transform: scale(0.94);
    }

    .stop {
      background: rgba(255, 60, 60, 0.62);
    }

    .stop-box {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      background: white;
    }

    .arrow {
      width: 0;
      height: 0;
      display: block;
    }

    .arrow-up {
      border-left: 11px solid transparent;
      border-right: 11px solid transparent;
      border-bottom: 17px solid white;
    }

    .arrow-down {
      border-left: 11px solid transparent;
      border-right: 11px solid transparent;
      border-top: 17px solid white;
    }

    .arrow-left {
      border-top: 11px solid transparent;
      border-bottom: 11px solid transparent;
      border-right: 17px solid white;
    }

    .arrow-right {
      border-top: 11px solid transparent;
      border-bottom: 11px solid transparent;
      border-left: 17px solid white;
    }

    .manual-only {
      display: none;
    }

    .manual-on .manual-only {
      display: flex;
    }

    @media (orientation: landscape) {
      .manual-btn {
        left: auto;
        right: calc(env(safe-area-inset-right, 0px) + 18px);
        bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
        transform: none;
      }

      .manual-btn:active {
        transform: scale(0.97);
      }

      .left-cluster {
        left: calc(env(safe-area-inset-left, 0px) + 26px);
        bottom: calc(env(safe-area-inset-bottom, 0px) + 30px);
        gap: 12px;
      }

      .right-cluster {
        right: calc(env(safe-area-inset-right, 0px) + 28px);
        bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
        grid-template-columns: 58px;
        grid-template-rows: 58px 58px 58px;
        gap: 9px;
      }

      .ctrl {
        width: 58px;
        height: 58px;
      }
    }

    @media (min-width: 800px) {
      .ctrl {
        width: 66px;
        height: 66px;
      }

      .right-cluster {
        grid-template-columns: 66px;
        grid-template-rows: 66px 66px 66px;
      }

      .hud-btn {
        width: 46px;
        height: 46px;
        font-size: 12px;
      }

      .manual-btn {
        height: 52px;
      }
    }
  </style>
</head>

<body>
  <div class="screen">
    <img class="video" id="stream" src="">
    <div class="shade"></div>

    <div class="brand">ROBOT CAR</div>
    <div class="status" id="status">CAM LIVE</div>

    <div class="top-actions">
      <button class="hud-btn" id="fsBtn">FS</button>
      <button class="hud-btn" id="exitFsBtn">ESC</button>
      <button class="hud-btn manual-only" id="lightBtn">L</button>
      <button class="hud-btn manual-only" id="exitBtn">M</button>
    </div>

    <button class="manual-btn" id="manualBtn">TAKE MANUAL CONTROL</button>

    <div class="controls" id="controls">
      <div class="left-cluster">
        <button class="ctrl drive" data-cmd="L">
          <span class="arrow arrow-left"></span>
        </button>

        <button class="ctrl drive" data-cmd="R">
          <span class="arrow arrow-right"></span>
        </button>
      </div>

      <div class="right-cluster">
        <button class="ctrl drive" data-cmd="F">
          <span class="arrow arrow-up"></span>
        </button>

        <button class="ctrl stop" data-cmd="S">
          <span class="stop-box"></span>
        </button>

        <button class="ctrl drive" data-cmd="B">
          <span class="arrow arrow-down"></span>
        </button>
      </div>
    </div>
  </div>

  <script>
    const stream = document.getElementById("stream");
    const controls = document.getElementById("controls");
    const manualBtn = document.getElementById("manualBtn");
    const exitBtn = document.getElementById("exitBtn");
    const lightBtn = document.getElementById("lightBtn");
    const fsBtn = document.getElementById("fsBtn");
    const exitFsBtn = document.getElementById("exitFsBtn");
    const statusText = document.getElementById("status");

    let manualMode = false;
    let lightOn = false;
    let lastCmd = "";
    let activeKey = "";

    stream.src = "http://" + location.hostname + ":81/stream";

    function setStatus(text) {
      statusText.textContent = text;
    }

    function enterFullscreen() {
      const el = document.documentElement;

      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }

      if (window.screen.orientation && window.screen.orientation.lock) {
        window.screen.orientation.lock("landscape").catch(() => {});
      }
    }

    function exitFullscreen() {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }

      if (window.screen.orientation && window.screen.orientation.unlock) {
        try {
          window.screen.orientation.unlock();
        } catch (e) {}
      }
    }

    function sendCommand(cmd) {
      if (cmd === lastCmd && cmd !== "S") return;

      lastCmd = cmd;

      fetch("/cmd?go=" + cmd)
        .then(() => setStatus("CMD " + cmd))
        .catch(() => setStatus("LINK ERROR"));
    }

    function stopNow() {
      sendCommand("S");
      lastCmd = "";

      document.querySelectorAll(".ctrl").forEach(btn => {
        btn.classList.remove("active");
      });
    }

    function startManual() {
      manualMode = true;
      document.body.classList.add("manual-on");
      controls.classList.add("show");
      manualBtn.style.display = "none";
      enterFullscreen();
      sendCommand("M1");
      setStatus("MANUAL");
    }

    function exitManual() {
      stopNow();
      sendCommand("M0");
      manualMode = false;
      document.body.classList.remove("manual-on");
      controls.classList.remove("show");
      manualBtn.style.display = "block";
      setStatus("CAM LIVE");
    }

    manualBtn.addEventListener("click", startManual);
    fsBtn.addEventListener("click", enterFullscreen);
    exitFsBtn.addEventListener("click", exitFullscreen);
    exitBtn.addEventListener("click", exitManual);

    lightBtn.addEventListener("click", () => {
      lightOn = !lightOn;
      sendCommand(lightOn ? "LED1" : "LED0");
      lightBtn.classList.toggle("active", lightOn);
    });

    document.querySelectorAll(".drive").forEach((btn) => {
      const cmd = btn.dataset.cmd;

      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add("active");
        sendCommand(cmd);

        if (navigator.vibrate) {
          navigator.vibrate(18);
        }
      });

      btn.addEventListener("pointerup", (e) => {
        e.preventDefault();
        btn.classList.remove("active");
        stopNow();
      });

      btn.addEventListener("pointercancel", (e) => {
        e.preventDefault();
        btn.classList.remove("active");
        stopNow();
      });

      btn.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") {
          btn.classList.remove("active");
          stopNow();
        }
      });
    });

    document.querySelector(".stop").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stopNow();
    });

    document.addEventListener("keydown", (e) => {
      if (!manualMode) return;

      let cmd = "";

      if (e.key === "ArrowUp") {
        cmd = "F";
      } else if (e.key === "ArrowDown") {
        cmd = "B";
      } else if (e.key === "ArrowLeft") {
        cmd = "L";
      } else if (e.key === "ArrowRight") {
        cmd = "R";
      } else if (e.code === "Space") {
        e.preventDefault();
        activeKey = "";
        stopNow();
        return;
      } else {
        return;
      }

      e.preventDefault();

      if (activeKey === e.key) return;

      activeKey = e.key;
      sendCommand(cmd);
    });

    document.addEventListener("keyup", (e) => {
      if (!manualMode) return;

      if (
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight"
      ) {
        e.preventDefault();
        activeKey = "";
        stopNow();
      }
    });

    window.addEventListener("blur", () => {
      if (manualMode) {
        stopNow();
      }
    });

    window.addEventListener("beforeunload", () => {
      stopNow();
    });
  </script>
</body>
</html>
)rawliteral";

void sendToDevKit(const char *message) {
  DevKitSerial.println(message);
  Serial.print("[CAM -> DEVKIT] ");
  Serial.println(message);
}

void processWebCommand(const char *cmd) {
  const char *message = "CAM_CMD,UNKNOWN";

  if (strcmp(cmd, "M1") == 0) {
    message = "CAM_CMD,MANUAL_ON";
  } else if (strcmp(cmd, "M0") == 0) {
    message = "CAM_CMD,MANUAL_OFF";
  } else if (strcmp(cmd, "F") == 0) {
    message = "CAM_CMD,FWD";
  } else if (strcmp(cmd, "B") == 0) {
    message = "CAM_CMD,BACK";
  } else if (strcmp(cmd, "L") == 0) {
    message = "CAM_CMD,LEFT";
  } else if (strcmp(cmd, "R") == 0) {
    message = "CAM_CMD,RIGHT";
  } else if (strcmp(cmd, "S") == 0) {
    message = "CAM_CMD,STOP";
  } else if (strcmp(cmd, "LED1") == 0) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    message = "CAM_CMD,LIGHT_ON";
  } else if (strcmp(cmd, "LED0") == 0) {
    digitalWrite(FLASH_LED_PIN, LOW);
    message = "CAM_CMD,LIGHT_OFF";
  }

  sendToDevKit(message);
}

esp_err_t indexHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

esp_err_t cmdHandler(httpd_req_t *req) {
  char query[80];
  char value[20];

  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    if (httpd_query_key_value(query, "go", value, sizeof(value)) == ESP_OK) {
      processWebCommand(value);

      httpd_resp_set_type(req, "text/plain");
      httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

      return httpd_resp_send(req, "OK", HTTPD_RESP_USE_STRLEN);
    }
  }

  httpd_resp_set_type(req, "text/plain");
  return httpd_resp_send(req, "BAD_CMD", HTTPD_RESP_USE_STRLEN);
}

esp_err_t streamHandler(httpd_req_t *req) {
  camera_fb_t *fb = NULL;
  esp_err_t res = ESP_OK;

  char partBuffer[96];

  res = httpd_resp_set_type(req, "multipart/x-mixed-replace;boundary=frame");

  if (res != ESP_OK) {
    return res;
  }

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    fb = esp_camera_fb_get();

    if (!fb) {
      Serial.println("[CAM] Frame capture failed");
      res = ESP_FAIL;
      break;
    }

    res = httpd_resp_send_chunk(req, "--frame\r\n", 9);

    if (res == ESP_OK) {
      size_t headerLength = snprintf(
        partBuffer,
        sizeof(partBuffer),
        "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
        (unsigned int)fb->len
      );

      res = httpd_resp_send_chunk(req, partBuffer, headerLength);
    }

    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    }

    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, "\r\n", 2);
    }

    esp_camera_fb_return(fb);
    fb = NULL;

    if (res != ESP_OK) {
      break;
    }

    delay(8);
  }

  return res;
}

void startServers() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();

  config.server_port = 80;
  config.ctrl_port = 32768;

  httpd_uri_t indexUri;
  memset(&indexUri, 0, sizeof(indexUri));
  indexUri.uri = "/";
  indexUri.method = HTTP_GET;
  indexUri.handler = indexHandler;
  indexUri.user_ctx = NULL;

  httpd_uri_t cmdUri;
  memset(&cmdUri, 0, sizeof(cmdUri));
  cmdUri.uri = "/cmd";
  cmdUri.method = HTTP_GET;
  cmdUri.handler = cmdHandler;
  cmdUri.user_ctx = NULL;

  if (httpd_start(&cameraHttpd, &config) == ESP_OK) {
    httpd_register_uri_handler(cameraHttpd, &indexUri);
    httpd_register_uri_handler(cameraHttpd, &cmdUri);
    Serial.println("[HTTP] Control server started on port 80");
  }

  httpd_config_t streamConfig = HTTPD_DEFAULT_CONFIG();

  streamConfig.server_port = 81;
  streamConfig.ctrl_port = 32769;

  httpd_uri_t streamUri;
  memset(&streamUri, 0, sizeof(streamUri));
  streamUri.uri = "/stream";
  streamUri.method = HTTP_GET;
  streamUri.handler = streamHandler;
  streamUri.user_ctx = NULL;

  if (httpd_start(&streamHttpd, &streamConfig) == ESP_OK) {
    httpd_register_uri_handler(streamHttpd, &streamUri);
    Serial.println("[HTTP] Stream server started on port 81");
  }
}

bool startCamera() {
  camera_config_t camConfig;

  camConfig.ledc_channel = LEDC_CHANNEL_0;
  camConfig.ledc_timer = LEDC_TIMER_0;

  camConfig.pin_d0 = Y2_GPIO_NUM;
  camConfig.pin_d1 = Y3_GPIO_NUM;
  camConfig.pin_d2 = Y4_GPIO_NUM;
  camConfig.pin_d3 = Y5_GPIO_NUM;
  camConfig.pin_d4 = Y6_GPIO_NUM;
  camConfig.pin_d5 = Y7_GPIO_NUM;
  camConfig.pin_d6 = Y8_GPIO_NUM;
  camConfig.pin_d7 = Y9_GPIO_NUM;

  camConfig.pin_xclk = XCLK_GPIO_NUM;
  camConfig.pin_pclk = PCLK_GPIO_NUM;
  camConfig.pin_vsync = VSYNC_GPIO_NUM;
  camConfig.pin_href = HREF_GPIO_NUM;
  camConfig.pin_sccb_sda = SIOD_GPIO_NUM;
  camConfig.pin_sccb_scl = SIOC_GPIO_NUM;
  camConfig.pin_pwdn = PWDN_GPIO_NUM;
  camConfig.pin_reset = RESET_GPIO_NUM;

  camConfig.xclk_freq_hz = 20000000;
  camConfig.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    camConfig.frame_size = FRAMESIZE_QVGA;
    camConfig.jpeg_quality = 12;
    camConfig.fb_count = 2;
    camConfig.fb_location = CAMERA_FB_IN_PSRAM;
    camConfig.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    camConfig.frame_size = FRAMESIZE_QVGA;
    camConfig.jpeg_quality = 14;
    camConfig.fb_count = 1;
    camConfig.fb_location = CAMERA_FB_IN_DRAM;
    camConfig.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&camConfig);

  if (err != ESP_OK) {
    Serial.printf("[CAM] Camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t *sensor = esp_camera_sensor_get();

  if (sensor) {
    sensor->set_brightness(sensor, 0);
    sensor->set_contrast(sensor, 0);
    sensor->set_saturation(sensor, 0);
    sensor->set_framesize(sensor, FRAMESIZE_QVGA);
  }

  Serial.println("[CAM] Camera started");
  return true;
}

void readDevKitReplies() {
  while (DevKitSerial.available()) {
    char c = DevKitSerial.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      devkitLine[devkitLineIndex] = '\0';

      if (devkitLineIndex > 0) {
        Serial.print("[DEVKIT -> CAM] ");
        Serial.println(devkitLine);
      }

      devkitLineIndex = 0;
      return;
    }

    if (devkitLineIndex < sizeof(devkitLine) - 1) {
      devkitLine[devkitLineIndex] = c;
      devkitLineIndex++;
    } else {
      devkitLineIndex = 0;
    }
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  Serial.begin(USB_BAUD);
  DevKitSerial.begin(LINK_BAUD, SERIAL_8N1, CAM_RX_PIN, CAM_TX_PIN);

  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("ESP32-CAM ROBOT LIVE CONTROL");
  Serial.println("================================");

  if (!startCamera()) {
    Serial.println("[BOOT] Camera failed. Restarting...");
    delay(3000);
    ESP.restart();
  }

  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);

  bool apStarted = WiFi.softAP(AP_SSID, AP_PASSWORD, 1, 0, 1);

  if (!apStarted) {
    Serial.println("[WiFi] AP start failed");
    delay(3000);
    ESP.restart();
  }

  IPAddress ip = WiFi.softAPIP();

  Serial.println();
  Serial.print("[WiFi] SSID: ");
  Serial.println(AP_SSID);
  Serial.print("[WiFi] Password: ");
  Serial.println(AP_PASSWORD);
  Serial.print("[WiFi] Open: http://");
  Serial.println(ip);
  Serial.println();

  startServers();

  sendToDevKit("CAM_BOOTED");
  sendToDevKit("CAM_CMD,READY");

  Serial.println("================================");
  Serial.println("Connect phone to RobotCar-CAM");
  Serial.println("Open browser: http://192.168.4.1");
  Serial.println("================================");
}

void loop() {
  readDevKitReplies();
  delay(5);
}