import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path
import sys
import os

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from bankai import get_target_os, detect_os

def test_get_target_os_explicit():
    """Test that explicitly provided OS argument is respected."""
    assert get_target_os("cachyos") == "cachyos"
    assert get_target_os("kubuntu") == "kubuntu"
    assert get_target_os("nobara") == "nobara"

def test_get_target_os_aliases():
    """Test that OS aliases work correctly."""
    assert get_target_os("arch") == "cachyos"
    assert get_target_os("debian") == "kubuntu"
    assert get_target_os("fedora") == "nobara"

@patch('bankai.detect_os')
def test_get_target_os_auto_detection(mock_detect):
    """Test automatic OS detection fallback."""
    mock_detect.return_value = "cachyos"
    assert get_target_os(None) == "cachyos"

@patch('bankai.Path')
def test_detect_os_cachyos(mock_path):
    """Test detection of CachyOS."""
    mock_file = MagicMock()
    mock_file.exists.return_value = True
    # Mock opening /etc/os-release
    mock_open = MagicMock()
    mock_open.__enter__.return_value = [
        'ID="cachyos"\n',
        'ID_LIKE="arch"\n'
    ]
    mock_file.open.return_value = mock_open
    mock_path.return_value = mock_file
    
    assert detect_os() == "cachyos"

@patch('bankai.Path')
def test_detect_os_ubuntu(mock_path):
    """Test detection of Ubuntu/Debian."""
    mock_file = MagicMock()
    mock_file.exists.return_value = True
    mock_open = MagicMock()
    mock_open.__enter__.return_value = [
        'ID="ubuntu"\n',
        'ID_LIKE="debian"\n'
    ]
    mock_file.open.return_value = mock_open
    mock_path.return_value = mock_file
    
    assert detect_os() == "kubuntu"

