# Исправление сборки Elio 1.0.1: Windows cp1252

Причина из журнала: `tools/test_studio_desktop_contract.py` вызывал `Path.read_text()` без кодировки. На Windows Python 3.13 выбрал cp1252 для UTF-8 исходников и остановился на байте 0x81. До Rust-компиляции этот запуск не дошёл.

Исправления:
- Явная `encoding="utf-8"` для чтения исходников в `tools/test_studio_desktop_contract.py`.
- Явная UTF-8 для текстового ввода/вывода в `tools/stamp_build.py` и `tools/package_windows.py`.
- `$env:PYTHONUTF8 = "1"` в начале `Build-Windows.ps1`, до первого запуска Python.
- Новый `tools/test_windows_text_encoding.py` принудительно моделирует cp1252 даже на UTF-8 системе. Он воспроизводит исходную ошибку декодирования, затем запускает реальные desktop-contract, stamp и packager fixture с проверкой отсутствия неявных кодировок. В сборке запускается после подготовки проверенного Engram runtime, до компиляции.

Проверки: регрессия cp1252, desktop contract, packager fixture со всеми SHA256, Python syntax, tool-error recovery и 11 сценариев карточек прошли.

Это полный исходник. Заменить им файлы репозитория и повторить прежний **Build Windows → Run workflow**. Предыдущие исправления агента/карточек и автоматизация Studio сохранены. `npm warn deprecated whatwg-encoding` в журнале — предупреждение, не причина остановки.
