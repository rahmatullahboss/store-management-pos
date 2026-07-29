const navToggle = document.querySelector("[data-nav-toggle]");
const navigation = document.querySelector("[data-navigation]");

if (navToggle instanceof HTMLButtonElement && navigation instanceof HTMLElement) {
  const setNavigationOpen = (open) => {
    navToggle.setAttribute("aria-expanded", String(open));
    navigation.classList.toggle("is-open", open);
  };

  navToggle.addEventListener("click", () => {
    setNavigationOpen(navToggle.getAttribute("aria-expanded") !== "true");
  });

  navigation.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) setNavigationOpen(false);
  });
}

const billingButtons = [...document.querySelectorAll("[data-billing]")];
const priceValues = [...document.querySelectorAll("[data-monthly][data-annual]")];
const priceSuffixes = [...document.querySelectorAll("[data-monthly-suffix][data-annual-suffix]")];
const launchPricing = [
  { monthly: "৳899", annual: "৳8,990" },
  { monthly: "৳2,499", annual: "৳24,990" },
  { monthly: "৳5,999", annual: "৳59,990" },
];

for (const [index, value] of priceValues.entries()) {
  if (!(value instanceof HTMLElement)) continue;
  const price = launchPricing[index];
  if (price === undefined) continue;
  value.dataset.monthly = price.monthly;
  value.dataset.annual = price.annual;
  value.textContent = price.monthly;
}

for (const button of billingButtons) {
  if (!(button instanceof HTMLButtonElement)) continue;

  button.addEventListener("click", () => {
    const period = button.dataset.billing === "annual" ? "annual" : "monthly";

    for (const candidate of billingButtons) {
      if (!(candidate instanceof HTMLButtonElement)) continue;
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }

    for (const value of priceValues) {
      if (!(value instanceof HTMLElement)) continue;
      value.textContent = period === "annual" ? value.dataset.annual ?? "" : value.dataset.monthly ?? "";
    }

    for (const suffix of priceSuffixes) {
      if (!(suffix instanceof HTMLElement)) continue;
      suffix.textContent = period === "annual" ? suffix.dataset.annualSuffix ?? "" : suffix.dataset.monthlySuffix ?? "";
    }
  });
}

const stageTitle = document.querySelector("[data-stage-title]");
const stageStatus = document.querySelector("[data-stage-status]");
const stageLinks = [...document.querySelectorAll("[data-stage-link]")];
const chapters = [...document.querySelectorAll("[data-stage]")];

const activateStage = (stage) => {
  const chapter = chapters.find((candidate) => candidate instanceof HTMLElement && candidate.dataset.stage === stage);
  if (!(chapter instanceof HTMLElement)) return;

  if (stageTitle instanceof HTMLElement) stageTitle.textContent = chapter.dataset.title ?? "Transaction stage";
  if (stageStatus instanceof HTMLElement) stageStatus.textContent = chapter.dataset.status ?? "Trace available";

  for (const link of stageLinks) {
    if (!(link instanceof HTMLElement)) continue;
    link.classList.toggle("is-current", link.dataset.stageLink === stage);
  }
};

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (visible?.target instanceof HTMLElement && visible.target.dataset.stage) {
        activateStage(visible.target.dataset.stage);
      }
    },
    { rootMargin: "-28% 0px -52%", threshold: [0.1, 0.35, 0.6] },
  );

  for (const chapter of chapters) observer.observe(chapter);
}
