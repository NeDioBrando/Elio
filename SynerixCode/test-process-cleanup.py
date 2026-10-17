"""Updater fixture cleanup accepts completed exits, never hides live failures."""
from pathlib import Path
import sys, subprocess, unittest
from unittest.mock import Mock
sys.path.insert(0, str(Path(__file__).resolve().parent / 'test-support'))
from process_cleanup import stop_fixture_process

class CleanupTests(unittest.TestCase):
 def fixture(self, code=0):
  process=Mock(pid=123);process.poll.return_value=None
  runner=Mock(return_value=subprocess.CompletedProcess([], code, 'root terminated; ', 'child already exited'))
  return process,runner
 def test_child_exit_race_waits_for_owned_root(self):
  process,runner=self.fixture(128);process.wait.return_value=0
  stop_fixture_process(process,windows=True,runner=runner)
  runner.assert_called_once_with(['taskkill','/PID','123','/T','/F'],capture_output=True,text=True,timeout=10)
  process.wait.assert_called_once_with(timeout=5);process.kill.assert_not_called()
 def test_failed_termination_with_live_root_still_fails(self):
  process,runner=self.fixture(128);process.wait.side_effect=subprocess.TimeoutExpired('owned process',5)
  with self.assertRaisesRegex(RuntimeError,'root terminated; child already exited'):
   stop_fixture_process(process,windows=True,runner=runner)
  process.wait.assert_called_once_with(timeout=5)
 def test_successful_tree_stop_has_bounded_force_fallback(self):
  process,runner=self.fixture();process.wait.side_effect=[subprocess.TimeoutExpired('owned process',5),0]
  stop_fixture_process(process,windows=True,runner=runner)
  process.kill.assert_called_once();self.assertEqual(process.wait.call_count,2)
  self.assertTrue(all(call.kwargs=={'timeout':5} for call in process.wait.call_args_list))
 def test_force_fallback_cannot_wait_forever(self):
  process,runner=self.fixture();process.wait.side_effect=subprocess.TimeoutExpired('owned process',5)
  with self.assertRaises(subprocess.TimeoutExpired):stop_fixture_process(process,windows=True,runner=runner)
  self.assertEqual(process.wait.call_count,2)
 def test_already_exited_process_is_not_targeted(self):
  process,runner=self.fixture();process.poll.return_value=0
  stop_fixture_process(process,windows=True,runner=runner);runner.assert_not_called();process.wait.assert_not_called()
 def test_posix_cleanup_remains_scoped(self):
  process,runner=self.fixture();stop_fixture_process(process,windows=False,runner=runner)
  runner.assert_not_called();process.terminate.assert_called_once();process.wait.assert_called_once_with(timeout=5)

if __name__=='__main__':unittest.main()
