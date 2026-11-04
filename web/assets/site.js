(() => {
  "use strict";

  const DEFAULT_DESCRIPTION = "圆润的小机器人，蓝白配色，会挥手和休息";

  const buildCommand = (description) => {
    const subject = description.trim() || DEFAULT_DESCRIPTION;
    return [
      `请先阅读 https://markflow.wuhupan.top/mcp/ 和 https://markflow.wuhupan.top/mcp/ai.txt ，遵循 https://markflow.wuhupan.top/mcp/pet.schema.json 的规范，使用我已配置的 markflow-pet MCP，为我制作【${subject}】。`,
      "先调用 pet_get_schema 和 pet_prepare_generation，再使用你自己的绘图或动画工具生成素材并保存到本机。",
      "完整包先校验再安装，单图或精灵图按运行时规范创建；最后切换新角色、显示宠物并核对状态。",
      "如果尚未接入MCP或缺少生成工具，明确告诉我缺少哪一步，不要声称已生成或已安装。"
    ].join("\n\n");
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
      }
    }

    const activeElement = document.activeElement;
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.inset = "0 auto auto -9999px";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }

    helper.remove();
    if (activeElement instanceof HTMLElement) {
      activeElement.focus();
    }
    return copied;
  };

  const initializeCommand = () => {
    const descriptionInput = document.querySelector("#pet-description");
    const commandText = document.querySelector("#command-text");
    const copyButton = document.querySelector("#copy-command");
    const copyStatus = document.querySelector("#copy-status");

    if (!descriptionInput || !commandText || !copyButton) {
      return;
    }

    const syncCommand = () => {
      commandText.textContent = buildCommand(descriptionInput.value);
    };

    syncCommand();
    descriptionInput.addEventListener("input", syncCommand);

    let statusTimer = 0;

    copyButton.addEventListener("click", async () => {
      const originalLabel = "复制指令";
      const copied = await copyText(commandText.textContent || "");

      copyButton.textContent = copied ? "已复制" : "复制失败";
      if (copyStatus) {
        copyStatus.textContent = copied
          ? "指令已复制，可以粘贴给外部 AI。"
          : "未能自动复制，请选中上方指令手动复制。";
      }

      window.clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => {
        copyButton.textContent = originalLabel;
        if (copyStatus) {
          copyStatus.textContent = "";
        }
      }, 3200);
    });
  };

  const initializeLightbox = () => {
    const triggers = document.querySelectorAll("[data-shot]");
    const dialog = document.querySelector("#lightbox");
    const image = document.querySelector("#lightbox-image");
    const caption = document.querySelector("#lightbox-caption");
    const originalLink = document.querySelector("#lightbox-original");
    const closeButton = document.querySelector("#lightbox-close");

    if (!triggers.length || !dialog || !image || !caption || !closeButton) {
      return;
    }

    let opener = null;
    let closeTimer = 0;

    const closeDialog = () => {
      if (dialog.open) {
        dialog.close();
      }
    };

    triggers.forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const source = trigger.getAttribute("data-shot");
        if (!source) {
          return;
        }

        opener = trigger;
        image.src = source;
        image.alt = trigger.getAttribute("data-alt") || "";
        caption.textContent = trigger.getAttribute("data-caption") || "";
        if (originalLink instanceof HTMLAnchorElement) {
          originalLink.href = source;
        }

        window.clearTimeout(closeTimer);
        document.documentElement.classList.add("dialog-open");

        if (typeof dialog.showModal === "function") {
          dialog.showModal();
        } else {
          dialog.setAttribute("open", "");
        }

        closeButton.focus();
      });
    });

    closeButton.addEventListener("click", closeDialog);

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        closeDialog();
      }
    });

    dialog.addEventListener("close", () => {
      document.documentElement.classList.remove("dialog-open");
      image.removeAttribute("src");
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (opener instanceof HTMLElement && document.contains(opener)) {
          opener.focus();
        }
        opener = null;
      }, 0);
    });
  };

  initializeCommand();
  initializeLightbox();
})();
