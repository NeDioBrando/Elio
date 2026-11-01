# Исправление стеклянного оформления Elio

- Убрана сине-голубая палитра: светлая жемчужная и нейтральная графитовая темы.
- Полупрозрачные панели с backdrop-filter blur(24px), световой кромкой, нижним ободком и контактной тенью. Боковая панель и заголовок используют blur(28px).
- Стеклянные панели Home, источник памяти, оболочка Memory и настройки. Поля ввода и область чтения остаются почти непрозрачными.
- Сохранены настройки темы, ручное закрепление vault и независимость от назначения проекта.
- Есть непрозрачный fallback для reduced-transparency, forced-colors и отсутствия backdrop-filter.
- Это CSS-аппроксимация стекла, не нативный материал Apple и не физически корректная рефракция.

## Проверки

Пройдены test-vault-selection-ui.cjs (Chromium, тестовый HTTP-транспорт): Home и Memory в обеих темах при 1460×950 и 390×844; прозрачная заливка, вычисленный blur и inset-кромка; закрепление vault, ошибки сохранения, Auto, RU-метки, несохранённые правки и reduced-motion. Снимки Home/Memory, Settings, Chat, заметки и редактора просмотрены по отдельности.

Пройдены test-elio-theme.cjs, test-vault-contract.cjs, test-elio-audit.cjs. Контраст репрезентативных пар текста — не ниже 6.16:1. Эта цифра относится к токенам, не ко всем пикселям полупрозрачной поверхности.

Windows/WebView2 визуально на реальном пользовательском компьютере не проверялся. Результаты новой Windows-сборки — в соответствующей GitHub Actions run.

## Основа материала

- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass
- https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter
