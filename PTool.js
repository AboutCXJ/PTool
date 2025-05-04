// ==UserScript==
// @name         PTool
// @namespace    https://github.com/AboutCXJ
// @version      2025-05-05
// @description  PT站点自动批量下载种子
// @author       AboutCXJ/Yichaocp
// @updateURL    https://raw.githubusercontent.com/yichaocp/PTool/main/PTool.js
// @downloadURL  https://raw.githubusercontent.com/yichaocp/PTool/main/PTool.js
// @include      https://*
// @include      http://*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        GM_notification
// ==/UserScript==

(function () {
  "use strict";

  // 配置参数
  // prettier-ignore
  const ptoolConfig = {
    totalPages:         10,         //要下载的种子页数
    maxSeedSize:        0,          //种子最大大小(MB)
    pageDelay:          10 * 1000,  //翻页延时(ms)
    singleSeedDelay:    3 * 1000,   //单种延时(ms)
    multipleSeedDelay:  60 * 1000,  //多种延时(ms)
    excludeDownloading: true,       //排除正在下载中的种子
    excludeSeeding:     true,       //排除正在做种中的种子
    excludeDeadSeed:    true,       //排除死种
    dryRun:             false,      //模拟运行
    seedGap:            128,        //累计下载多少个种子触发一次多种延时
  };

  // 状态统计
  let currentPage = 1;
  let downloadCount = 0;
  let isRunning = false;
  let isStopped = false;

  // 全局对象
  let logPanel;
  let beginPanel;
  let selector;

  // M-Team站点
  const mteamSites = ["m-team"];

  // NexusPHP站点
  const nexusPHPSites = ["hdfans.org", "hdvideo.one", "ubits.club", "pt.btschool.club"];

  // 所有站点
  const allSites = [...mteamSites, ...nexusPHPSites];

  // 种子页面路径
  const torrentsPagePaths = ["browse", "torrents.php"];

  // 加载样式
  function loadPToolStyle() {
    if (!document.getElementById("ptool-style")) {
      const style = document.createElement("style");
      style.id = "ptool-style";
      style.innerHTML = `
        .ptool-begin-panel {
          position: fixed;
          bottom: 10px;
          left: 10px;
          width: 180px;
          height: 400px;
          z-index: 10000;
          padding: 10px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
          background-color: #BDCAD6;
          border-radius: 5px;
          font-size: 12px;
        }
        .ptool-log-panel {
          position: fixed;
          bottom: 10px;
          left: 200px;
          width: 720px;
          height: 400px;
          z-index: 10000;
          padding: 5px;
          background-color: rgba(0, 0, 0, 0.7);
          border-radius: 5px;
          color: white;
          font-size: 10px;
          overflow-y: scroll;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        }
        .ptool-log-panel::-webkit-scrollbar {
          width: 8px;
          background: transparent;
          border-radius: 5px;
        }
        .ptool-log-panel::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.8);
          border-radius: 5px;
        }
        .ptool-bp-title {
          text-align: center;
          color: black;
          margin: 0 0 10px 0;
          font-size: 16px;
          font-weight: bold;
        }
        .ptool-bp-input-module {
          display: flex;
        }
        .ptool-bp-input {
          border-radius: 5px;
          padding: 5px;
          color: black;
          margin: 5px 0;
          width: 60px;
        }
        .ptool-bp-label {
          white-space: nowrap;
          border-radius: 5px;
          width: 100%;
          padding: 5px;
          color: black;
          margin: 5px 0;
        }
        .ptool-btn-begin {
        display: inline-block;
          width: 45%;
          padding: 5px;
          border: none;
          border-radius: 5px;
          margin: 5px 0;
          background-color: green;
          color: black;
          float: left;
          cursor: pointer;
        }
        .ptool-btn-begin:disabled {
          background-color: #ccc !important;
          color: #888 !important;
          cursor: not-allowed !important;
        }
        .ptool-btn-end {
        display: inline-block;
          width: 45%;
          padding: 5px;
          border: none;
          border-radius: 5px;
          margin: 5px 0;
          background-color: white;
          color: black;
          float: right;
          cursor: pointer;
        }
        .ptool-btn-end:disabled {
          background-color: #ccc !important;
          color: #888 !important;
          cursor: not-allowed !important;
        }
        .ptool-lp-container {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          gap: 10px;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // 加载页面元素选择器
  function loadSelector(currentURL) {
    if (mteamSites.some((site) => currentURL.includes(site))) {
      selector = {
        list: "tbody tr",
        title: "td:nth-child(3)",
        downloader: "td button",
        progressBar: "div[aria-valuenow='100']",
        size: "td div[class='mx-[-5px]']",
        seeders: "td span[aria-label*='arrow-up'] + span",
        leechers: "td span[aria-label*='arrow-down'] + span",
        nextPage: "li[title='下一頁'] button",
      };
    } else if (nexusPHPSites.some((site) => currentURL.includes(site))) {
      selector = {
        list: "table[class='torrents'] > tbody > tr",
        title: "table[class='torrentname'] tr td",
        downloader: "table[class='torrentname'] tr td[width] a",
        progressBar: "div[title*=seeding]",
        size: "td:nth-child(5)",
        seeders: "td:nth-child(6)",
        leechers: "td:nth-child(7)",
        nextPage: "p[class='nexus-pagination'] a",
      };
    }
  }

  // 监听URL变化
  function observeURLChange() {
    let previousURL = location.href;

    // 创建监视器
    const observer = new MutationObserver(() => {
      const currentURL = location.href;
      if (currentURL !== previousURL) {
        previousURL = currentURL;
        handleURLChange(currentURL);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 处理URL变化
  function handleURLChange(currentURL) {
    if (!allSites.some((site) => currentURL.includes(site))) {
      return;
    }

    if (torrentsPagePaths.some((path) => currentURL.includes(path))) {
      loadPToolStyle();
      loadSelector(currentURL);
      loadBeginPanel();
    } else {
      removeBeginPanel();
      removeLogPanel();
    }
  }

  // 加载开始面板
  function loadBeginPanel() {
    if (beginPanel) return;

    beginPanel = document.createElement("div");
    beginPanel.className = "ptool-begin-panel";
    document.body.appendChild(beginPanel);

    // 标题
    const title = document.createElement("h3");
    title.innerText = "PTool种子下载助手";
    title.className = "ptool-bp-title";
    beginPanel.appendChild(title);

    // 下载几页
    const totalPagesInput = document.createElement("input");
    totalPagesInput.type = "number";
    totalPagesInput.max = 100;
    totalPagesInput.value = ptoolConfig.totalPages;
    beginPanel.appendChild(createInputModule(totalPagesInput, `下载几页：`));

    // 种子大小
    const maxSeedSizeInput = document.createElement("input");
    maxSeedSizeInput.type = "number";
    maxSeedSizeInput.max = 1024 * 1024;
    maxSeedSizeInput.value = ptoolConfig.maxSeedSize;
    beginPanel.appendChild(createInputModule(maxSeedSizeInput, `种子大小：(MB)`));

    // 翻页延时
    const pageDelayInput = document.createElement("input");
    pageDelayInput.placeholder = `翻页延时？${formatTime(ptoolConfig.pageDelay)}`;
    pageDelayInput.type = "number";
    pageDelayInput.value = ptoolConfig.pageDelay / 1000;
    beginPanel.appendChild(createInputModule(pageDelayInput, `翻页延时：(秒)`));

    // 单种延时
    const singleSeedDelayInput = document.createElement("input");
    singleSeedDelayInput.type = "number";
    singleSeedDelayInput.step = 0.1;
    singleSeedDelayInput.value = ptoolConfig.singleSeedDelay / 1000;
    beginPanel.appendChild(createInputModule(singleSeedDelayInput, `单种延时：(秒)`));

    // 多种延时
    const multipleSeedDelayInput = document.createElement("input");
    multipleSeedDelayInput.type = "number";
    multipleSeedDelayInput.value = ptoolConfig.multipleSeedDelay / 1000 / 60;
    beginPanel.appendChild(createInputModule(multipleSeedDelayInput, `多种延时：(分)`));

    // 排除正在下载
    const excludeDownloadingCheck = document.createElement("input");
    excludeDownloadingCheck.type = "checkbox";
    excludeDownloadingCheck.checked = ptoolConfig.excludeDownloading;
    beginPanel.appendChild(createInputModule(excludeDownloadingCheck, `排除正在下载：`));

    // 排除正在做种
    const excludeSeedingCheck = document.createElement("input");
    excludeSeedingCheck.type = "checkbox";
    excludeSeedingCheck.checked = ptoolConfig.excludeSeeding;
    beginPanel.appendChild(createInputModule(excludeSeedingCheck, `排除正在做种：`));

    // 排除死种
    const excludeDeadSeedCheck = document.createElement("input");
    excludeDeadSeedCheck.type = "checkbox";
    excludeDeadSeedCheck.checked = ptoolConfig.excludeDeadSeed;
    beginPanel.appendChild(createInputModule(excludeDeadSeedCheck, `排除死种：`));

    // 模拟运行
    const dryRunCheck = document.createElement("input");
    dryRunCheck.type = "checkbox";
    dryRunCheck.checked = ptoolConfig.dryRun;
    beginPanel.appendChild(createInputModule(dryRunCheck, `模拟运行：`));

    // 开始按钮
    const beginButton = document.createElement("button");
    beginButton.innerText = "开始";
    beginButton.className = "ptool-btn-begin";
    beginButton.disabled = false;
    beginPanel.appendChild(beginButton);

    // 结束按钮
    const endButton = document.createElement("button");
    endButton.innerText = "结束";
    endButton.className = "ptool-btn-end";
    endButton.disabled = true;
    beginPanel.appendChild(endButton);

    // 开始按钮点击事件前先判断 isRunning
    beginButton.addEventListener("click", () => {
      if (isRunning) return;
      loadLogPanel();
      ptoolConfig.totalPages = totalPagesInput.value || ptoolConfig.totalPages;
      ptoolConfig.maxSeedSize = maxSeedSizeInput.value || ptoolConfig.maxSeedSize;
      ptoolConfig.pageDelay = pageDelayInput.value * 1000;
      ptoolConfig.singleSeedDelay = singleSeedDelayInput.value * 1000;
      ptoolConfig.multipleSeedDelay = multipleSeedDelayInput.value * 1000 * 60;
      ptoolConfig.excludeDownloading = excludeDownloadingCheck.checked;
      ptoolConfig.excludeSeeding = excludeSeedingCheck.checked;
      ptoolConfig.excludeDeadSeed = excludeDeadSeedCheck.checked;
      ptoolConfig.dryRun = dryRunCheck.checked;

      if (
        ptoolConfig.singleSeedDelay < 0 ||
        ptoolConfig.multipleSeedDelay < 0 ||
        ptoolConfig.pageDelay < 0 ||
        ptoolConfig.totalPages < 1 ||
        ptoolConfig.totalPages > 100
      ) {
        panelMessage("请输入正确的参数！M-Team限制：100种/小时，1000种/天. ");
        return;
      }

      beginButton.disabled = true;
      endButton.disabled = false;

      clearLogPanel();
      begin();
    });

    // 结束按钮点击事件：支持中断
    endButton.addEventListener("click", async () => {
      isStopped = true;

      // 等待任务结束
      let count = 10;
      await new Promise((resolve) => {
        const timer = setInterval(() => {
          panelMessage(`正在停止任务：${count}，请稍候...`);
          if (!isRunning || --count == 0) {
            clearInterval(timer);
            resolve();
          }
        }, 500);
      });
      panelMessage("任务已手动停止！");

      clearLogPanel();
      removeLogPanel();

      beginButton.disabled = false;
      endButton.disabled = true;
      currentPage = 1;
      downloadCount = 0;
    });

    // 内部接口：创建输入模块
    function createInputModule(input, tip) {
      const div = document.createElement("div");
      div.className = "ptool-bp-input-module";

      const label = document.createElement("label");
      label.innerText = tip;
      label.className = "ptool-bp-label";
      input.className = "ptool-bp-input";

      div.appendChild(label);
      div.appendChild(input);

      return div;
    }
  }

  // 内部接口：移除开始面板
  function removeBeginPanel() {
    if (beginPanel) {
      beginPanel.remove();
      beginPanel = null;
    }
  }

  // 内部接口：加载日志面板
  function loadLogPanel() {
    if (logPanel) return;

    logPanel = document.createElement("div");
    logPanel.className = "ptool-log-panel";
    document.body.appendChild(logPanel);
  }

  // 内部接口：清空日志面板
  function clearLogPanel() {
    logPanel.innerHTML = "";
  }

  // 内部接口：打印日志
  function panelMessage(message) {
    const timestamp = new Date().toLocaleString();
    logPanel.innerHTML += `<hr/><div class="ptool-lp-container"><div style="width:100px;">[${timestamp}]</div>${message}</div>`;
    if (logPanel.scrollTop + logPanel.clientHeight >= logPanel.scrollHeight - 50) {
      logPanel.scrollTop = logPanel.scrollHeight;
    }
    console.log(`[${timestamp}]  ${message}`);
  }

  // 内部接口：移除日志面板
  function removeLogPanel() {
    if (logPanel) {
      logPanel.remove();
      logPanel = null;
    }
  }

  // 内部接口：格式化时间
  function formatTime(milliseconds) {
    let totalSeconds = Math.fround(milliseconds / 1000).toFixed(2); // 转换为秒
    if (totalSeconds < 60) {
      return `${totalSeconds} 秒`;
    } else if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分钟 ${seconds} 秒`;
    } else {
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}${
        seconds > 0 ? ` ${seconds} 秒` : ""
      }`;
    }
  }

  // 页面数据预处理
  function preprocessingDatas() {
    const list = document.querySelectorAll(selector.list);

    let datas = Array();
    for (let index = 0; index < list.length; index++) {
      const element = list[index];
      var data = new Object();

      let title = element.querySelector(selector.title);
      if (title) {
        data.title = title.innerText.replace(/[\r\n]+/g, "").trim();
      } else {
        continue;
      }

      data.downloader = element.querySelector(selector.downloader);

      let progress = element.querySelector(selector.progressBar);
      if (progress) {
        let progressBg = progress.querySelector(".ant-progress-bg.ant-progress-bg-outer");
        if (progressBg && progressBg.style.background === "rgb(158, 158, 158)") {
          data.downloading = true;
          data.seeding = false;
        } else {
          data.downloading = false;
          data.seeding = true;
        }
      } else {
        data.downloading = false;
        data.seeding = false;
      }

      let size = element.querySelector(selector.size);
      if (size) {
        data.size = size.innerText.replace(/[\r\n]+/g, "").trim();
      }

      let seeders = element.querySelector(selector.seeders);
      if (seeders) {
        data.seeders = seeders.innerText;
      }

      let leechers = element.querySelector(selector.leechers);
      if (leechers) {
        data.leechers = leechers.innerText;
      }

      datas.push(data);
    }

    return datas;
  }

  // 下载种子
  async function downloadTorrents() {
    const datas = preprocessingDatas();

    for (let i = 0; i < datas.length; i++) {
      if (isStopped) break;

      const data = datas[i];

      let shoudleSkip = false;
      let skipReason = "";

      // 排除种子大小
      if (ptoolConfig.maxSeedSize > 0) {
        if (data.size && data.size.includes("GB")) {
          let size = parseFloat(data.size.replace("GB", ""));
          if (size * 1024 > ptoolConfig.maxSeedSize) {
            shoudleSkip = true;
            skipReason = `种子超过${ptoolConfig.maxSeedSize}MB`;
          }
        } else if (data.size && data.size.includes("MB")) {
          let size = parseFloat(data.size.replace("MB", ""));
          if (size > ptoolConfig.maxSeedSize) {
            shoudleSkip = true;
            skipReason = `种子超过${ptoolConfig.maxSeedSize}MB`;
          }
        } else {
          shoudleSkip = true;
          skipReason = `种子大小未知`;
        }
      }

      // 排除正在下载
      if (data.downloading && ptoolConfig.excludeDownloading) {
        shoudleSkip = true;
        skipReason = "正在下载";
      }

      // 排除正在做种
      if (data.seeding && ptoolConfig.excludeSeeding) {
        shoudleSkip = true;
        skipReason = "正在做种";
      }

      // 排除死种
      if (data.seeders === "0" && ptoolConfig.excludeDeadSeed) {
        shoudleSkip = true;
        skipReason = "死种";
      }

      panelMessage(
        `<div style="width:40px;">页：${currentPage}</div>` +
          `<div style="width:40px;">种：${i + 1}</div>` +
          `<div style="width:80px;">大小：${data.size}</div>` +
          `<div style="width:60px;">上传：${data.seeders}</div>` +
          `<div style="width:60px;">下载：${data.leechers}</div>` +
          `<div style="width:60px;">做种：${data.seeding}</div>` +
          `<div style="width:60px;">跳过：${shoudleSkip}</div>` +
          `<div style="width:120px;">原因：${skipReason}</div>`
      );

      if (shoudleSkip) {
        continue;
      }

      if (!ptoolConfig.dryRun) {
        data.downloader.click();
      }

      downloadCount++;

      // 多种延时
      if (downloadCount % ptoolConfig.seedGap === 0) {
        panelMessage(
          `已下载${downloadCount}个种子，等待${formatTime(ptoolConfig.multipleSeedDelay)}`
        );
        await new Promise((resolve) => setTimeout(resolve, ptoolConfig.multipleSeedDelay));
      }

      await new Promise((resolve) => setTimeout(resolve, ptoolConfig.singleSeedDelay));
    }
  }

  // 翻页
  async function goToNextPage() {
    if (isStopped) return false;

    const nextPageButton = document.querySelector(selector.nextPage);

    // 翻页延时
    if (nextPageButton) {
      nextPageButton.click();
      panelMessage(`翻到第${currentPage + 1}页。等待${formatTime(ptoolConfig.pageDelay)}。`);
      await new Promise((resolve) => setTimeout(resolve, ptoolConfig.pageDelay));
    } else {
      panelMessage("未找到翻页按钮！");
      return false;
    }

    return true;
  }

  // begin 函数增加运行中判断
  async function begin() {
    if (isRunning) return;
    isRunning = true;
    isStopped = false;
    try {
      panelMessage(
        `<div style="width: 20%;">下载页数：${ptoolConfig.totalPages}</div>` +
          `<div style="width: 20%;">种子大小：${ptoolConfig.maxSeedSize}MB</div>` +
          `<div style="width: 20%;">翻页延时：${formatTime(ptoolConfig.pageDelay)}</div>` +
          `<div style="width: 20%;">单种延时：${formatTime(ptoolConfig.singleSeedDelay)}</div>` +
          `<div style="width: 20%;">多种延时：${formatTime(ptoolConfig.multipleSeedDelay)}</div>` +
          `<div style="width: 20%;">排除正在下载：${ptoolConfig.excludeDownloading}</div>` +
          `<div style="width: 20%;">排除正在做种：${ptoolConfig.excludeSeeding}</div>` +
          `<div style="width: 20%;">排除死种：${ptoolConfig.excludeDeadSeed}</div>` +
          `<div style="width: 20%;">模拟运行：${ptoolConfig.dryRun}</div>`
      );

      while (currentPage <= ptoolConfig.totalPages && !isStopped) {
        panelMessage(`开始下载第${currentPage}页，共${ptoolConfig.totalPages}页。`);
        await downloadTorrents();

        if (currentPage < ptoolConfig.totalPages) {
          const hasNextPage = await goToNextPage();
          if (!hasNextPage) break;
        }
        currentPage++;
      }
      if (!isStopped) {
        let finishTip = `全部任务已完成，共下载${downloadCount}个种子！`;
        panelMessage(finishTip);
        GM_notification(finishTip);
      }
    } catch (e) {
      GM_notification(`发生错误：${e.message}`);
    } finally {
      isRunning = false;
      isStopped = true;
      currentPage = 1;
      downloadCount = 0;
    }
  }

  // 初始化监听
  observeURLChange();

  // 初始检查
  handleURLChange(location.href);
})();
