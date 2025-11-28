import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path
import sys

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from os_scripts.cachyos import command_exists, install_packages_from_file

def test_command_exists():
    """Test checking for command existence."""
    with patch('shutil.which') as mock_which:
        mock_which.return_value = "/usr/bin/git"
        assert command_exists("git") is True
        
        mock_which.return_value = None
        assert command_exists("nonexistentcommand") is False

@patch('os_scripts.cachyos.run_command')
@patch('pathlib.Path.is_file')
@patch('pathlib.Path.read_text')
def test_install_packages_from_file(mock_read, mock_is_file, mock_run):
    """Test reading packages from file and installing them."""
    mock_is_file.return_value = True
    mock_read.return_value = "package1\npackage2\n#comment\n\npackage3"
    
    install_packages_from_file("dummy_path", "pacman -S")
    
    # Verify the command was called with the correct packages
    # Should include package1, package2, package3, ignoring comments and empty lines
    args = mock_run.call_args[0][0]
    assert "package1" in args
    assert "package2" in args
    assert "package3" in args
    assert "pacman -S" in args

