import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path
import shutil
import sys

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

# Manually define KDE_SHORTCUTS_PATH for testing purposes if import fails,
# or better, mock it entirely since we're patching it anyway.
# The ImportError happens because os_scripts/cachyos.py relies on project structure 
# that might look different in the test environment or due to circular imports?
# Actually, let's just import the module and patch attributes.

import os_scripts.cachyos as cachyos_module

def test_configure_kde_shortcuts_apply(tmp_path):
    """Test that KDE shortcuts are applied correctly."""
    # Setup mock home directory
    mock_home = tmp_path / "home"
    mock_home.mkdir()
    mock_config = mock_home / ".config"
    mock_config.mkdir()
    
    # Create existing config file with some realistic content
    existing_conf = mock_config / "kglobalshortcutsrc"
    existing_conf.write_text("[General]\nTest=ExistingShortcut")
    
    # Mock KDE_SHORTCUTS_PATH to point to a real file
    mock_shortcuts_file = tmp_path / "new_shortcuts.kksrc"
    mock_shortcuts_file.write_text("[General]\nTest=NewShortcut")

    with (
        patch("os_scripts.cachyos.HOME", mock_home),
        patch("os_scripts.cachyos.prompt_user", return_value=True),
        patch("os_scripts.cachyos.KDE_SHORTCUTS_PATH", mock_shortcuts_file),
        patch("os_scripts.cachyos.run_command"),
    ):

        cachyos_module.configure_kde()
        
        # Check if backup was created
        backup_file = existing_conf.with_suffix(".bak")
        assert backup_file.exists()
        assert backup_file.read_text() == "[General]\nTest=ExistingShortcut"
        
        # Check if new content was copied
        assert existing_conf.read_text() == "[General]\nTest=NewShortcut"

def test_configure_kde_shortcuts_skip():
    """Test that shortcuts are skipped when user says no."""
    with patch('os_scripts.cachyos.prompt_user', return_value=False), \
         patch('os_scripts.cachyos.run_command'):
        
        # Should run without errors and not attempt any file operations
        cachyos_module.configure_kde()

def test_configure_kde_shortcuts_missing_file(tmp_path):
    """Test handling when source shortcut file is missing."""
    # Mock KDE_SHORTCUTS_PATH to non-existent file
    non_existent = tmp_path / "does_not_exist"
    
    with patch('os_scripts.cachyos.prompt_user', return_value=True), \
         patch('os_scripts.cachyos.KDE_SHORTCUTS_PATH', non_existent), \
         patch('os_scripts.cachyos.run_command'):
        
        # Should log warning but not fail
        cachyos_module.configure_kde()
