document.getElementById("reason").textContent = new URLSearchParams(location.search).get("reason") || "";
document.getElementById("back").addEventListener("click", () => {
  if (history.length > 2) history.go(-2);
  else location.href = "about:blank";
});
