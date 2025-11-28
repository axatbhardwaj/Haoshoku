import pytest
from pathlib import Path
import sys

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

def test_common_directory_structure():
    """Test that the common directory exists and has required files."""
    # When running tests locally
    root_dir = Path(__file__).parent.parent
    common_dir = root_dir / "common"
    
    assert common_dir.exists(), "common directory must exist"
    assert common_dir.is_dir(), "common must be a directory"
    
    required_files = [
        "paru_applist.txt",
        "flatpacks_arch.txt",
        "apt_applist.txt",
        "dnf_applist.txt",
        "flatpacks.txt",
        "snap_applist.txt",
        "__init__.py"
    ]
    
    for filename in required_files:
        file_path = common_dir / filename
        assert file_path.exists(), f"{filename} must exist in common directory"
        assert file_path.is_file(), f"{filename} must be a file"

def test_common_files_content():
    """Test that common files are not empty and have valid content."""
    root_dir = Path(__file__).parent.parent
    common_dir = root_dir / "common"
    
    # Test package list files
    package_lists = [
        "paru_applist.txt",
        "flatpacks_arch.txt",
        "apt_applist.txt",
        "dnf_applist.txt",
        "flatpacks.txt",
        "snap_applist.txt"
    ]
    
    for filename in package_lists:
        file_path = common_dir / filename
        content = file_path.read_text().strip()
        
        # Check file is not empty (unless it's intended to be empty, but usually these shouldn't be)
        assert len(content) > 0, f"{filename} should not be empty"
        
        # Check content format - lines should not start with whitespace
        lines = content.splitlines()
        for i, line in enumerate(lines):
            if line.strip() and not line.startswith('#'):
                assert not line.startswith(' '), f"Line {i+1} in {filename} has leading whitespace"

def test_package_data_access():
    """Test that we can access these files via package resources (simulating installed package)."""
    # This test simulates how the code would access files when installed
    # Note: This depends on the package being installed or editable install, 
    # but we can check if the mechanism works relative to the package root
    
    try:
        import common
        common_path = Path(common.__file__).parent
        assert common_path.exists()
        assert (common_path / "paru_applist.txt").exists()
    except ImportError:
        pytest.skip("common package not importable - skipping package access test")

