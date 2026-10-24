# Elio 1.0.1 — исправления после живого аудита

## Что передаётся

Полные исходники поверх публичного коммита `27f9fc71b27bba86c9296b00a5259d0cd53076eb` репозитория NeDioBrando/Elio. Версия приложения и расширения остаётся **1.0.1**. Это не готовый Windows EXE и не опубликованный релиз. Изменения не отправлялись в GitHub. Папка `.git`, зависимости Node и результаты компиляции в архив не включаются.

Основной код расширения и `elio-Extension/` синхронизированы побайтово. Стартовая identity и фраза `Elio is ready to assist you.` сохранены; `core/config.js` не изменялся.

## Исправленные причины сбоев

| Область | Исправление | Проверка |
|---|---|---|
| Маршрутизация skill | Убрано неявное превращение skill(skill_name=имя команды) в выполнение той команды. Запрос справки больше не становится builder-операцией. | Реальный guard, точные входы из аудита, сохранение команды и параметров. |
| Справка builder/preview | Добавлена read-only команда `elio_tool_schema`: полная схема, проверяемый пример preview, различие save/replace/patch/insert, вложенный build_id и class. Ошибка неизвестного поля перечисляет разрешённые поля. | Выполнение handler в VM; пример проходит реальный compiler; неизвестная команда/лишние аргументы отвергаются. |
| Auto-enhancer | Диагностический preview-save больше не запускает enhancer без настоящей задачи создания модели/UI. | Исполнение scope-gate с диагностическим вызовом. |
| Ответ enhancer | Требуется JSON с совпадающим request_id и enhanced_prompt. Обычный ответ, сообщение Stop, чужой ответ и command/feedback вместо brief не пересылаются как новый запрос. Ошибка не теряет исходный запрос. | Корреляция, дедупликация, Stop/navigation, fallback; исходные ограничения сохраняются. |
| Русский scope | Распознаются русские запросы создания модели/UI и ограничения «не вставляй», «только предпросмотр/черновик». | Целевые регрессии; это не обещание полного распознавания любого естественного языка. |
| Файлы Notion | Длинный результат с префиксом retained-result остаётся результатом команды, а не повторным startup. Служебный файл больше не описывается как запрос нового подключения. | Production provider с DOM/Chrome-заглушками: 4 конфигурации; проверены файл, обёртка, upload/send, чужие вложения и Stop. |
| Motion scope | Учитывается singular scope; конфликт scope/scopes отклоняется. | Реальный compiler и проверки нормализованного запроса. |
| Motion pagination | Продолжение сохраняет полный исходный список scopes, budget, глубину, max_items и include_duplicates. Scanned scopes отмечаются отдельно. | Compiler + форматирование и повторная компиляция continuation. |
| Motion receipt | Результат read/copy/integrate возвращается из Luau, а не только печатается в консоль. Ранние ошибки также возвращают receipt. | Реальный Luau-интерпретатор, mock DataModel, success/error, copy и integration. Старые записи консоли не используются как подтверждение нового действия. |
| Motion copy syntax | Исправлен неэкранированный перенос строки в manifestHash, из-за которого сгенерированная программа копирования не компилировалась. | Сгенерированный Luau компилируется и выполняет copy, fidelity и replay; generated ModuleScript тоже компилируется. |
| Engram в Windows | В комплект добавлен официальный Engram 3.0.0 с MIT-лицензией. Подготовка проверяет закреплённые SHA256 архива и executable, ограничивает размер, устанавливает атомарно и отказывает при подмене. Пакет включает runtime и notices. | Настоящая загрузка, оба хеша, offline reuse, отрицательные случаи и реальный Python-packager с явно маркированным product EXE fixture. Сам Windows Engram здесь не запускался. |
| Engram updater | Разрешены только точные runtime-файлы; произвольные runtime EXE не добавлены в allowlist. Те же файлы попадают в штатный backup/copy/rollback. | Добавлены Windows PowerShell fixtures на install/rollback/посторонний EXE; в Linux они **не запускались**. Включены в Build-Windows.ps1. |
| Auto visual | Упоминания Color3/BasePart/Lighting/чтение свойств больше не считаются визуальной мутацией. Комментарии, строки и сравнения исключены; запись свойств, создание и изменение геометрии остаются триггерами. | Положительные/отрицательные регрессии, включая long strings и комментарии. Это эвристика, а не полный анализ произвольного Luau. |
| Auto Debug | Вместо безусловного «Fix these next» лог помечен как наблюдение, требующее проверки актуальности и намеренных диагностических ошибок в рамках текущей задачи. | Проверка источника; ошибки не скрываются и не подавляются. |
| Тестовые стенды | Исправлены недостающие зависимости VM: crypto/parser/theme state; fixture auto-enhancer помечает настоящую creatorTask. Добавлены регрессии в Windows build gate. | Повторные прогоны. |

## Что действительно проверено

- **163/163 JS-тестов** заключительного прогона прошли. Имена и длительности — в `LIVE-AUDIT-TEST-RESULTS.json`.
- **132 Rust-проверки прошли (129 binary + 3 library), 1 ignored**, ошибок нет. Это Linux, не Windows.
- `cargo build --locked` успешно собрал нативный Linux agent.
- На этом агенте отдельно прошёл `test-bridges.js`: HTTP, оба WebSocket-моста, разные extension identities, отказ стороннему web origin, изоляция параллельных сокетов. Только временный workspace; Roblox Studio на агент-компьютере не был подключён.
- Luau: чтение VFX, возврат ошибок, точное копирование, проверка fingerprint, replay, установка presentation runtime и компиляция полученного ModuleScript. DataModel был тестовым, не настоящим Studio.
- Chromium UI fixtures: actual desktop/popup/overlay HTML и JS с API-заглушками, светлая/тёмная темы, отсутствие синего в проверенных контролах, состояния чата и responsive-представления.
- Реальный Python-packager собрал и проверил ZIP с тестовым продуктовым EXE и настоящим проверенным Engram sidecar. Это не Windows-сборка приложения.
- Главный промпт/identity, версия и побайтовая синхронизация копий расширения проходят существующие проверки.

Полный первоначальный запуск охватил все **185 корневых JS/CJS-тестов**. Падения были отдельно воспроизведены на неизменённом исходном коммите. Новое требование creatorTask внесено в соответствующий fixture; parity восстановлена синхронизацией файлов; таймаут расширенного protocol fixture устранён исправлением самого fixture. Оставшиеся 22 исходных падения включали `test-bridges.js`, который затем прошёл на реально запущенном изолированном агенте. Остальные **21 тест** по-прежнему не проходят без изменения их старых требований/окружения — их результат не объявляется зелёным.

Эти 21 тест ожидают старые версии/палитры/донаты, удалённые файлы и внешнюю папку development, старые VM/HTML-контракты либо жёсткие исторические хеши. `test-design-visual.js` дополнительно требует отдельного Playwright browser install и не использует CHROMIUM_PATH. Их не переписывали задним числом ради зелёного отчёта:

- `test-1.20.0-regressions.js`
- `test-1.22.0-debug-capture.js`
- `test-1.24.12-fixes.js`
- `test-1.24.13-merged-fixes.js`
- `test-approach-summary.js`
- `test-blender.js`
- `test-claude.js`
- `test-clickup-provider.js`
- `test-design-upgrade.js`
- `test-design-visual.js`
- `test-desktop-regression.js`
- `test-donation-links.js`
- `test-package-version-display.js`
- `test-provider-preservation.js`
- `test-supported-ai-icons.js`
- `test-supported-ai-links.js`
- `test-ultracode-default.js`
- `test-v111.js`
- `test-v112.js`
- `test-v115.js`
- `test-v118.js`

## Ограничения

- Не запускались настоящий Windows EXE, Windows WebView2, обновление/rollback в Windows и новый Engram MCP-процесс на Windows. Их нужно проверить на GitHub Windows runner и затем на пользовательской установке.
- Не проверены оплачиваемая генерация, публикация ассетов, Blender без подключённого Blender и реальные сторонние облачные API.
- Нельзя обещать отсутствие всех багов или нулевые регрессии. Успешный mock/статический тест не равен успешной работе в реальном Studio.
- На пользовательском проекте при живом аудите не делались постоянные изменения. Последняя подтверждённая сцена соответствовала исходным шести Workspace descendants, Studio был возвращён в Edit. Работа над исходниками выполнялась отдельно.

## Как применить через GitHub Desktop

1. Открыть локальную папку **существующего** репозитория Elio через Repository → Show in Explorer.
2. Распаковать содержимое source ZIP прямо в эту папку с заменой файлов. Файлы manifest.json, Build-Windows.ps1, core/ и agent/ должны оказаться в корне репозитория, не во вложенной папке. **Не удалять .git** и пользовательские настройки/рабочие проекты.
3. В GitHub Desktop проверить Changes, указать Summary, Commit to main и Push origin. В архиве нет новой git-истории.
4. На GitHub Actions вручную запустить Windows workflow. Build-Windows.ps1 ставит тестовые зависимости из lockfile, проверяет runtime, выполняет gates, cargo test/build и создаёт install ZIP. Не отключать красный gate, если runner выявит платформенную проблему.
5. Использовать **полный** Windows ZIP из Artifacts, не отдельный EXE: runtime/engram и elio-Extension обязательны. Остановить агент перед заменой установленного комплекта. Перезагрузить unpacked extension и вкладки ИИ.
6. Вручную проверить первоначальное подключение, свежие streaming-ответы в desktop без refresh, диагностический preview без enhancer, read/copy Motion, Engram context, Stop/resume и сохранность пользовательских данных.

Версия не повышена, поэтому уже установленная 1.0.1 не должна автоматически считать этот исходник новой версией. Для этой тестовой замены нужен полный вручную пересобранный комплект. Не перезаписывать существующий опубликованный release/tag.

## Повторение целевых тестов (из корня репозитория)

```text
npm ci --prefix release-tools --include=dev --ignore-scripts
node test-live-audit-fixes.cjs
node tools/test_motion_luau.mjs
python tools/prepare_engram.py
python tools/test_prepare_engram.py
python tools/test_package_windows.py
cargo test --locked --manifest-path agent/Cargo.toml
```

Для JS-тестов, импортирующих jsdom напрямую, NODE_PATH должен указывать на release-tools/node_modules. Build-Windows.ps1 выставляет его сам. Подробности платформенных fixtures и mocked API указаны в исходниках тестов.
