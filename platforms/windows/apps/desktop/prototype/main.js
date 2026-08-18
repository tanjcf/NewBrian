const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const approveButton = document.getElementById("approveButton");
const runStatus = document.getElementById("runStatus");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.panel;

    tabs.forEach((item) => item.classList.remove("active"));
    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === target);
    });
    tab.classList.add("active");
  });
});

if (approveButton && runStatus) {
  approveButton.addEventListener("click", () => {
    runStatus.textContent = "Running";
    runStatus.classList.remove("medium");
    runStatus.classList.add("success");
  });
}
