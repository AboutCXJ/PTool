// ==UserScript==
// @name         PTool
// @namespace    https://github.com/AboutCXJ
// @version      2025-05-01
// @description  PT站点自动批量下载种子
// @author       AboutCXJ/Yichaocp
// @updateURL    https://raw.githubusercontent.com/yichaocp/PTool/refs/heads/main/PTool.js
// @downloadURL  https://raw.githubusercontent.com/yichaocp/PTool/refs/heads/main/PTool.js
// @include      https://*
// @include      http://*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tampermonkey.net
// @grant        GM_notification
// ==/UserScript==

(function () {
  "use strict";

  // M-Team下载限制1：单个IP每小时150个，可配合代理软件切换IP以解除限制。
  // M-Team下载限制2：单个账号每天1500个，每日0点重置。

  // 默认配置参数，这些参数可以根据需要进行调整。
  let totalPages = 10; //要下载的种子页数
  let maxSeedSize = 0; //种子最大大小(MB)
  let pageDelay = 10 * 1000; //翻页延时(ms)
  let singleSeedDelay = 3 * 1000; //单种延时(ms)
  let multipleSeedDelay = 60 * 1000; //多种延时(ms)
  let seedGap = 128; //累计下载多少个种子触发一次多种延时

  let excludeDownloading = true; //排除正在下载中的种子
  let excludeSeeding = true; //排除正在做种中的种子
  let excludeDeadSeed = true; //排除死种
  let dryRun = false; //模拟运行

  let currentPage = 1;
  let downloadCount = 0;

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
  function insertPToolStyle() {
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
          background: rgba(0,0,0,0.3);
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
      insertPToolStyle();
      loadSelector(currentURL);
      loadBeginPanel();
    } else {
      removeBeginPanel();
      removeLogPanel();
    }
  }

  //加载开始面板
  function loadBeginPanel() {
    if (beginPanel) return;

    beginPanel = document.createElement("div");
    beginPanel.className = "ptool-begin-panel";
    document.body.appendChild(beginPanel);

    //标题
    const title = document.createElement("h3");
    title.innerText = "PTool种子下载助手";
    title.className = "ptool-bp-title";
    beginPanel.appendChild(title);

    //下载几页
    const totalPagesInput = document.createElement("input");
    totalPagesInput.type = "number";
    totalPagesInput.max = 100;
    totalPagesInput.value = totalPages;
    beginPanel.appendChild(createInputModule(totalPagesInput, `下载几页：`));

    //种子大小
    const maxSeedSizeInput = document.createElement("input");
    maxSeedSizeInput.type = "number";
    maxSeedSizeInput.max = 1024 * 1024;
    maxSeedSizeInput.value = maxSeedSize;
    beginPanel.appendChild(createInputModule(maxSeedSizeInput, `种子大小：(MB)`));

    //翻页延时
    const pageDelayInput = document.createElement("input");
    pageDelayInput.placeholder = `翻页延时？${formatTime(pageDelay)}`;
    pageDelayInput.type = "number";
    pageDelayInput.value = pageDelay / 1000;
    beginPanel.appendChild(createInputModule(pageDelayInput, `翻页延时：(秒)`));

    //单种延时
    const singleSeedDelayInput = document.createElement("input");
    singleSeedDelayInput.type = "number";
    singleSeedDelayInput.step = 0.1;
    singleSeedDelayInput.value = singleSeedDelay / 1000;
    beginPanel.appendChild(createInputModule(singleSeedDelayInput, `单种延时：(秒)`));

    //多种延时
    const multipleSeedDelayInput = document.createElement("input");
    multipleSeedDelayInput.type = "number";
    multipleSeedDelayInput.value = multipleSeedDelay / 1000 / 60;
    beginPanel.appendChild(createInputModule(multipleSeedDelayInput, `多种延时：(分)`));

    //排除正在下载
    const excludeDownloadingCheck = document.createElement("input");
    excludeDownloadingCheck.type = "checkbox";
    excludeDownloadingCheck.checked = excludeDownloading;
    beginPanel.appendChild(createInputModule(excludeDownloadingCheck, `排除正在下载：`));

    //排除正在做种
    const excludeSeedingCheck = document.createElement("input");
    excludeSeedingCheck.type = "checkbox";
    excludeSeedingCheck.checked = excludeSeeding;
    beginPanel.appendChild(createInputModule(excludeSeedingCheck, `排除正在做种：`));

    //排除死种
    const excludeDeadSeedCheck = document.createElement("input");
    excludeDeadSeedCheck.type = "checkbox";
    excludeDeadSeedCheck.checked = excludeDeadSeed;
    beginPanel.appendChild(createInputModule(excludeDeadSeedCheck, `排除死种：`));

    //模拟运行
    const dryRunCheck = document.createElement("input");
    dryRunCheck.type = "checkbox";
    dryRunCheck.checked = dryRun;
    beginPanel.appendChild(createInputModule(dryRunCheck, `模拟运行：`));

    //开始按钮
    const beginButton = document.createElement("button");
    beginButton.innerText = "开始";
    beginButton.className = "ptool-btn-begin";
    beginButton.disabled = false;
    beginPanel.appendChild(beginButton);

    //结束按钮
    const endButton = document.createElement("button");
    endButton.innerText = "结束";
    endButton.className = "ptool-btn-end";
    endButton.disabled = true;
    beginPanel.appendChild(endButton);

    // 开始按钮点击事件
    beginButton.addEventListener("click", () => {
      loadLogPanel();
      totalPages = totalPagesInput.value || totalPages;
      maxSeedSize = maxSeedSizeInput.value || maxSeedSize;
      pageDelay = pageDelayInput.value * 1000;
      singleSeedDelay = singleSeedDelayInput.value * 1000;
      multipleSeedDelay = multipleSeedDelayInput.value * 1000 * 60;
      excludeDownloading = excludeDownloadingCheck.checked;
      excludeSeeding = excludeSeedingCheck.checked;
      excludeDeadSeed = excludeDeadSeedCheck.checked;
      dryRun = dryRunCheck.checked;

      if (
        singleSeedDelay < 0 ||
        multipleSeedDelay < 0 ||
        pageDelay < 0 ||
        totalPages < 1 ||
        totalPages > 100
      ) {
        panelMessage("请输入正确的参数！M-Team限制：150种/小时，1500种/天. ");
        return;
      }

      beginPanel.style.display = "block";
      beginButton.disabled = true;
      endButton.disabled = false;

      clearLogPanel();
      begin();
    });

    // 结束按钮点击事件
    endButton.addEventListener("click", () => {
      beginPanel.style.display = "block";
      beginButton.disabled = false;
      endButton.disabled = true;

      currentPage = 1;
      downloadCount = 0;

      clearLogPanel();
      removeLogPanel();
    });

    // 内部接口：创建输入模块
    function createInputModule(input, tip) {
      const div = document.createElement("div");
      div.className = "ptool-bp-input-module";

      input.className = "ptool-bp-input";

      const label = document.createElement("label");
      label.innerText = tip;
      label.className = "ptool-bp-label";

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
    logPanel.innerHTML += `<div>[${timestamp}]  ${message}</div>`;
    logPanel.scrollTop = logPanel.scrollHeight;
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
        data.title = title.innerText;
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
        data.size = size.innerText;
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
      const data = datas[i];

      let shoudleSkip = false;
      let skipReason = "";

      //排除种子大小
      if (maxSeedSize > 0) {
        if (data.size && data.size.includes("GB")) {
          let size = parseFloat(data.size.replace("GB", ""));
          if (size * 1024 > maxSeedSize) {
            shoudleSkip = true;
            skipReason = `种子超过${maxSeedSize}MB`;
          }
        } else if (data.size && data.size.includes("MB")) {
          let size = parseFloat(data.size.replace("MB", ""));
          if (size > maxSeedSize) {
            shoudleSkip = true;
            skipReason = `种子超过${maxSeedSize}MB`;
          }
        } else {
          shoudleSkip = true;
          skipReason = `种子大小未知`;
        }
      }

      //排除正在下载
      if (data.downloading && excludeDownloading) {
        shoudleSkip = true;
        skipReason = "正在下载";
      }

      //排除正在做种
      if (data.seeding && excludeSeeding) {
        shoudleSkip = true;
        skipReason = "正在做种";
      }

      //排除死种
      if (data.seeders === "0" && excludeDeadSeed) {
        shoudleSkip = true;
        skipReason = "死种";
      }

      panelMessage(
        `页：${currentPage}&nbsp;&nbsp;&nbsp;&nbsp;
        种：${i + 1}&nbsp;&nbsp;&nbsp;&nbsp;
        上传：${data.seeders}&nbsp;&nbsp;&nbsp;&nbsp;
        下载：${data.leechers}&nbsp;&nbsp;&nbsp;&nbsp;
        大小：${data.size}&nbsp;&nbsp;&nbsp;&nbsp;
        做种：${data.seeding}&nbsp;&nbsp;&nbsp;&nbsp;
        跳过：${shoudleSkip}&nbsp;&nbsp;&nbsp;&nbsp;
        原因：${skipReason}<hr />`
      );

      if (shoudleSkip) {
        continue;
      }

      if (!dryRun) {
        data.downloader.click();
      }

      downloadCount++;

      //多种延时
      if (downloadCount % seedGap === 0) {
        panelMessage(`已下载${downloadCount}个种子，等待${formatTime(multipleSeedDelay)}`);
        await new Promise((resolve) => setTimeout(resolve, multipleSeedDelay));
      }

      await new Promise((resolve) => setTimeout(resolve, singleSeedDelay));
    }
  }

  //翻页
  async function goToNextPage() {
    const nextPageButton = document.querySelector(selector.nextPage);

    //翻页延时
    if (nextPageButton) {
      nextPageButton.click();
      panelMessage(`翻到第${currentPage + 1}页。等待${formatTime(pageDelay)}。`);
      await new Promise((resolve) => setTimeout(resolve, pageDelay));
    } else {
      panelMessage("未找到翻页按钮！");
      return false;
    }

    return true;
  }

  //入口函数
  async function begin() {
    panelMessage(
      `<br />页数：${totalPages}  &nbsp;&nbsp;
        种子大小：${maxSeedSize}MB  &nbsp;&nbsp;
        翻页延时：${formatTime(pageDelay)}  &nbsp;&nbsp;
        单种延时：${formatTime(singleSeedDelay)}  &nbsp;&nbsp;
        多种延时：${formatTime(multipleSeedDelay)}  &nbsp;&nbsp;
        排除正在下载：${excludeDownloading}  &nbsp;&nbsp;
        排除正在做种：${excludeSeeding}  &nbsp;&nbsp;
        排除死种：${excludeDeadSeed}  &nbsp;&nbsp;
        模拟运行：${dryRun}<hr />`
    );

    while (currentPage <= totalPages) {
      panelMessage(`开始下载第${currentPage}页，共${totalPages}页。<hr />`);
      await downloadTorrents();

      if (currentPage < totalPages) {
        const hasNextPage = await goToNextPage();
        if (!hasNextPage) break;
      }

      currentPage++;
    }

    let finishTip = `全部任务已完成，共下载${downloadCount}个种子！`;
    panelMessage(finishTip);
    GM_notification(finishTip);

    //恢复初始状态
    currentPage = 1;
    downloadCount = 0;
    beginPanel.style.display = "block";
  }

  // 初始化监听
  observeURLChange();

  // 初始检查
  handleURLChange(location.href);
})();
