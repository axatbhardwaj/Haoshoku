#!/bin/bash

# --- Configuration ---
# Repository URL for your setup scripts
REPO_URL="https://github.com/axatbhardwaj/bankai.git"
# Directory name where the repo will be cloned (derived from URL)
REPO_DIR_NAME=$(basename "$REPO_URL" .git) # Extracts 'bankai' from the URL

# --- Script Setup ---
# Exit on any error (optional, uncomment if needed)
# set -e

# --- Helper Functions ---
# Prints an error message in red
print_error() {
  echo >&2 -e "\033[0;31mError: $1\033[0m"
}

# Prints an informational message in blue
print_info() {
  echo -e "\033[0;34mInfo: $1\033[0m"
}

# Prints a success message in green
print_success() {
  echo -e "\033[0;32mSuccess: $1\033[0m"
}

# Prints a warning message in yellow
print_warning() {
  echo -e "\033[0;33mWarning: $1\033[0m"
}

# Function for usage instructions
usage() {
  echo "Usage: $0 [--os <os_name>] [-h|--help] [script_arguments...]"
  echo ""
  echo "Downloads/updates the bankai setup repository and runs the appropriate OS setup script."
  echo ""
  echo "Options:"
  echo "  --os <os_name>  Specify the target OS type directly. Skips auto-detection."
  echo "                    Valid names: cachyos, arch, kubuntu, debian, ubuntu, nobara, fedora"
  echo "  -h, --help      Display this help message and exit."
  echo ""
  echo "Arguments:"
  echo "  [script_arguments...] Any remaining arguments are passed directly to the target OS script"
  echo "                      (e.g., cachyos.sh, kubuntu.sh, nobara.sh)."
  echo ""
  echo "Examples:"
  echo "  $0                # Auto-detect OS or prompt if needed"
  echo "  $0 --os kubuntu   # Force execution of kubuntu.sh"
  echo "  $0 --os cachyos --some-flag value # Run cachyos.sh with arguments"
}


# --- Prerequisite Checks ---

# Function to check if Git is installed and attempt installation if not
check_install_git() {
  if command -v git &> /dev/null; then
    print_info "Git is already installed."
    return 0 # Success
  fi

  print_warning "Git is not installed."
  local pm="" # Package manager name
  local install_cmd=""
  local update_cmd=""

  if command -v pacman &> /dev/null; then
    pm="pacman"
    install_cmd="sudo pacman -Syu --noconfirm git"
  elif command -v apt-get &> /dev/null; then
    pm="apt"
    update_cmd="sudo apt-get update"
    install_cmd="sudo apt-get install -y git"
  elif command -v dnf &> /dev/null; then
    pm="dnf"
    install_cmd="sudo dnf install -y git"
  else
    print_error "Could not determine package manager (pacman, apt, dnf) to install git automatically."
    print_error "Please install Git manually and rerun the script."
    return 1 # Failure
  fi

  print_info "Attempting to install git using $pm..."
  # Run update command first if needed (for apt)
  if [[ -n "$update_cmd" ]]; then
      if ! $update_cmd; then
          print_error "Failed to update package list using $pm."
          return 1
      fi
  fi
  # Run install command
  if ! $install_cmd; then
      print_error "Failed to install git using $pm. Command failed: '$install_cmd'"
      return 1
  fi

  # Verify installation
  if command -v git &> /dev/null; then
    print_success "Git installed successfully using $pm."
    return 0 # Success
  else
    print_error "Git command still not found after attempting installation with $pm."
    print_error "Please install Git manually and rerun the script."
    return 1 # Failure
  fi
}

# Check for Git
if ! check_install_git; then
    exit 1
fi

# Check if Bash is available (needed for the target scripts)
if ! command -v bash &> /dev/null; then
    print_error "Bash is required to run the target scripts. Please install bash."
    exit 1
fi

# --- Argument Parsing ---
TARGET_OS_ARG=""
SCRIPT_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --os)
      # Check if a value is provided and it's not another flag (starting with -)
      if [[ -n "$2" && ! "$2" =~ ^- ]]; then
        TARGET_OS_ARG=$(echo "$2" | tr '[:upper:]' '[:lower:]')
        print_info "OS specified via argument: $TARGET_OS_ARG"
        shift # Consume --os
        shift # Consume the OS value
      else
        print_error "--os flag requires a value (e.g., --os cachyos)."
        usage
        exit 1
      fi
      ;;
    *)
      # If it's not a known option, assume it's an argument for the target OS script
      SCRIPT_ARGS+=("$1")
      shift # Consume the argument
      ;;
  esac
done

# --- Clone or Update Repository ---
# Uses pushd/popd for safer directory changes during git pull
if [ -d "$REPO_DIR_NAME" ]; then
  print_info "Directory '$REPO_DIR_NAME' already exists. Attempting to pull latest changes..."
  pushd "$REPO_DIR_NAME" > /dev/null || { print_error "Could not change directory to $REPO_DIR_NAME."; exit 1; }
  if git pull; then
    print_success "Repository updated."
  else
    print_warning "Failed to pull repository updates. Continuing with existing local version. Check for conflicts or network issues."
    # Optional: exit 1 here if a failed pull should stop the script
  fi
  popd > /dev/null || { print_error "Could not return from $REPO_DIR_NAME directory."; exit 1; }
else
  print_info "Cloning repository $REPO_URL into '$REPO_DIR_NAME'..."
  if git clone "$REPO_URL" "$REPO_DIR_NAME"; then # Explicitly clone into the directory name
    print_success "Repository cloned successfully."
  else
    print_error "Failed to clone repository. Check the URL ($REPO_URL) and network connection."
    exit 1
  fi
fi

# --- OS Detection and Selection ---

SELECTED_OS_TYPE="" # Will hold the final OS choice (cachyos, kubuntu, nobara)

# Function to map OS identifier (ID, ID_LIKE, argument) to our script names
map_os_to_script_name() {
  local os_identifier="$1"
  local identifier_lower
  identifier_lower=$(echo "$os_identifier" | tr '[:upper:]' '[:lower:]')

  case "$identifier_lower" in
    *arch*|*cachyos*) echo "cachyos" ;;
    *debian*|*ubuntu*|*kubuntu*) echo "kubuntu" ;;
    *fedora*|*nobara*) echo "nobara" ;;
    *) echo "" ;; # Return empty string if no match
  esac
}

# Function to detect the OS using /etc/os-release
detect_os() {
  local detected_id=""
  local detected_family=""
  local mapped_os=""

  if [ ! -f /etc/os-release ]; then
      print_warning "/etc/os-release not found. Cannot automatically detect OS."
      return 1 # Indicate detection failure
  fi

  # Source the file in a subshell to avoid polluting current shell environment
  (
    # Ignore unbound variable errors during sourcing if /etc/os-release is weird
    set +u
    . /etc/os-release
    detected_id="${ID:-unknown}" # Provide default if unset
    # Use ID_LIKE if it exists and is non-empty, otherwise fallback to ID
    detected_family="${ID_LIKE:-$ID}"
    set -u
  )

  print_info "Detected OS ID: $detected_id, Family: $detected_family"

  # Try mapping family first, then ID
  mapped_os=$(map_os_to_script_name "$detected_family")
  if [[ -z "$mapped_os" ]]; then
    mapped_os=$(map_os_to_script_name "$detected_id")
  fi

  if [[ -n "$mapped_os" ]]; then
    SELECTED_OS_TYPE="$mapped_os" # Set the global variable
    print_info "Automatically selected OS script type: $SELECTED_OS_TYPE"
    return 0 # Indicate success
  else
    print_warning "Detected OS ('$detected_id' / '$detected_family') does not automatically map to a known script type (cachyos, kubuntu, nobara)."
    return 1 # Indicate mapping failure -> need manual selection
  fi
}

# Function to prompt the user to select the OS manually
select_os_manually() {
    print_info "Please select the target operating system script:"
    local options=("CachyOS (cachyos.sh)" "Kubuntu/Debian (kubuntu.sh)" "Fedora/Nobara (nobara.sh)" "Cancel")
    # Use PS3 for prompt string
    PS3="Enter choice (1-4): "
    # Use select command for menu, read from /dev/tty
    select os_choice in "${options[@]}" </dev/tty; do
        case "$os_choice" in
            "${options[0]}") SELECTED_OS_TYPE="cachyos"; break ;;
            "${options[1]}") SELECTED_OS_TYPE="kubuntu"; break ;;
            "${options[2]}") SELECTED_OS_TYPE="nobara"; break ;;
            "${options[3]}") echo "Operation cancelled by user."; exit 0 ;;
            *) print_warning "Invalid choice '$REPLY'. Please enter a number between 1 and ${#options[@]}." ;;
        esac
    done
    # Reset PS3
    PS3=""
    # Check if SELECTED_OS_TYPE was set (it should be if break was reached)
    if [[ -z "$SELECTED_OS_TYPE" ]]; then
        print_error "OS selection failed."
        exit 1
    fi
    print_info "Selected OS: $SELECTED_OS_TYPE"
}

# --- OS Determination Logic ---

# 1. Check if --os argument was provided and valid
if [[ -n "$TARGET_OS_ARG" ]]; then
    print_info "Attempting to use OS specified via --os argument: $TARGET_OS_ARG"
    mapped_os=$(map_os_to_script_name "$TARGET_OS_ARG")
    if [[ -n "$mapped_os" ]]; then
        SELECTED_OS_TYPE="$mapped_os"
        print_info "Using specified OS script type: $SELECTED_OS_TYPE"
    else
        print_error "Invalid OS specified with --os: '$TARGET_OS_ARG'."
        print_error "Allowed values (case-insensitive): cachyos, arch, kubuntu, debian, ubuntu, nobara, fedora."
        # Fall through to auto-detect/manual selection if arg is invalid
        # Reset TARGET_OS_ARG so we don't rely on the invalid value later
        TARGET_OS_ARG=""
    fi
fi

# 2. If OS type is not yet determined (no valid --os arg), try auto-detection
if [[ -z "$SELECTED_OS_TYPE" ]]; then
    print_info "Attempting to automatically detect OS..."
    if ! detect_os; then
        # Auto-detection failed or OS couldn't be mapped, trigger manual selection
        print_warning "Could not determine OS script type automatically."
        select_os_manually
    fi
fi

# 3. Final check: Ensure an OS type was determined one way or another
if [[ -z "$SELECTED_OS_TYPE" ]]; then
    print_error "Could not determine target OS script type. Exiting."
    exit 1
fi

# --- Execute Target Script ---

# Map the selected OS type to the script filename
TARGET_SCRIPT_NAME=""
case "$SELECTED_OS_TYPE" in
  cachyos) TARGET_SCRIPT_NAME="cachyos.sh" ;;
  kubuntu) TARGET_SCRIPT_NAME="kubuntu.sh" ;;
  nobara)  TARGET_SCRIPT_NAME="nobara.sh" ;;
  *)
    # This case should be impossible due to the check above, but serves as a safeguard
    print_error "Internal error: Invalid SELECTED_OS_TYPE '$SELECTED_OS_TYPE'."
    exit 1
    ;;
esac

# Change into the repository directory *before* executing the script
print_info "Changing directory to $REPO_DIR_NAME..."
cd "$REPO_DIR_NAME" || { print_error "Failed to enter repository directory '$REPO_DIR_NAME'."; exit 1; }

# Verify the target script exists in the current directory (we are now inside REPO_DIR_NAME)
if [ ! -f "./$TARGET_SCRIPT_NAME" ]; then
    print_error "Target script './$TARGET_SCRIPT_NAME' not found in the repository directory '$PWD'."
    # Attempt to list files for debugging info
    print_info "Contents of '$PWD':"
    ls -la
    exit 1
fi

# Grant execute permissions to the target script
print_info "Setting execute permissions for ./$TARGET_SCRIPT_NAME"
chmod +x "./$TARGET_SCRIPT_NAME" || { print_error "Failed to set execute permissions on ./$TARGET_SCRIPT_NAME"; exit 1; }

# Execute the target script using bash, passing any collected arguments
print_info "Executing ./$TARGET_SCRIPT_NAME with arguments: ${SCRIPT_ARGS[*]}"
if bash "./$TARGET_SCRIPT_NAME" "${SCRIPT_ARGS[@]}"; then
  print_success "$TARGET_SCRIPT_NAME executed successfully."
else
  # Capture the exit code from the failed script
  exit_code=$?
  print_error "$TARGET_SCRIPT_NAME finished with errors (exit code $exit_code)."
  # Propagate the error code from the target script
  exit $exit_code
fi

print_info "Bankai script finished successfully."
exit 0 # Explicitly exit with 0 on overall success
