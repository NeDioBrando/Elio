# Ручной vault и обновлённый интерфейс Elio

## Ручной выбор памяти

1. Подключите сохранённый чат и откройте **Memory**.
2. В списке проектов выберите vault. Это пока меняет только просмотр.
3. Нажмите **Use this vault for AI / Использовать этот vault для ИИ**.
4. Блок **AI memory source** покажет **Pinned / Закреплён**, имя vault и идентификатор чата.
5. **Auto-select vault / Выбирать vault автоматически** удаляет закрепление и возвращает прежнюю автоматическую маршрутизацию.

Выбор хранится локально в `checkpoints.json` отдельно для каждого чата. Он не перемещает и не копирует заметки, не меняет проект задачи и переживает перезапуск. Неизвестный vault и несохранённый чат отклоняются. Если сохранение не удалось, интерфейс не сообщает об успехе. Старые журналы без поля `vaults` остаются совместимыми.

Выбор управляется UI-only действиями `selection`/`select` в `/api/vault`; они не входят в список действий инструмента ИИ. Закрепление применяется нативным `/api/vault` к запросам с идентификатором чата, в том числе к автоматическому recall и AI context/search/read/save. Переданный агентом scope не может перебить ручной выбор. Просмотр другого vault в Memory остаётся независимым. Инвалидация зависимостей задачи учитывает закреплённый vault.

**Важно:** переключение влияет на новые запросы памяти. Уже отправленный в историю чата контекст и начатые операции нельзя отозвать. Для полной изоляции старого контекста используйте новый чат и закрепите vault в нём.

## Интерфейс

Liquid Glass-inspired оформление, а не нативный материал Apple:

- Светлая ледяная и тёмная сине-графитовая палитры; системный шрифт и более ясная иерархия.
- Стеклянный слой только в навигации и заголовке: ограниченный blur/saturation, прозрачная подложка и тонкий световой край. Заметки, код, формы и карточки остаются непрозрачными.
- Без постоянно анимируемых фильтров, отслеживания курсора и вложенных стеклянных карточек.
- Клавиатурный фокус, доступные названия, 44px основные элементы управления, адаптация на 390px; reduced-motion и reduced-transparency/forced-colors fallback.
- Существующие светлая/тёмная настройка и механизм сохранения темы сохранены.
- Новые элементы выбора памяти переведены на русский; названия проектов, заметок и код не переводятся.

Основания:

- Apple HIG — Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- Apple — Adopting Liquid Glass: https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass
- MDN — backdrop-filter: https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter

## Проверки

```sh
cargo test --locked --manifest-path agent/Cargo.toml --lib
cargo test --locked --manifest-path agent/Cargo.toml --bin elio
cargo build --locked --manifest-path agent/Cargo.toml
node test-vault-selection-live.cjs
NODE_PATH=release-tools/node_modules node test-vault-contract.cjs
NODE_PATH=release-tools/node_modules node test-elio-theme.cjs
NODE_PATH=release-tools/node_modules CHROMIUM_PATH=/path/to/chromium node test-vault-selection-ui.cjs
NODE_PATH=release-tools/node_modules CHROMIUM_PATH=/path/to/chromium node test-elio-theme-ui.cjs
```

Новый live-тест поднимает реальный native API в отдельном временном профиле и проверяет чтение, context, запись, изоляцию чатов, независимость просмотра/проекта, отказ неверным выборам, перезапуск и возврат в Auto. UI-тест использует детерминированный транспорт, проверяет кнопки, отказ сохранения, polling, несохранённые правки, локализацию и создаёт скриншоты desktop/mobile.

Это изменения исходников. Проверка Linux/Chromium не заменяет Windows/WebView2 smoke-test. Готовый Windows EXE и release в рамках этой правки не публикуются. Для установки нужна новая Windows-сборка; переустановка одного расширения не обновляет встроенный интерфейс нативного приложения.
