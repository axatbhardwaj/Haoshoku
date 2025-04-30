#!/bin/bash

# --- Configuration ---
# Repository URL for your setup scripts
REPO_URL="https://github.com/axatbhardwaj/bankai.git"
# Directory name where the repo will be cloned (derived from URL)
REPO_DIR_NAME=$(basename "$REPO_URL" .git) # Extracts 'bankai' from the URL

# --- Script Setup ---
# Exit on any error (optional, remove if you prefer manual checks everywhere)
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

# --- Check Prerequisites ---
# Check if Git is installed
if ! command -v git &> /dev/null; then
  print_error "Git is not installed. Please install Git and try again."
  exit 1
fi
# Check if Bash is available (needed for the target scripts)
if ! command -v bash &> /dev/null; then
    print_error "Bash is required to run the target scripts."
    exit 1
fi

# --- Argument Parsing ---
TARGET_OS_ARG="" # Stores OS specified via --os flag
SCRIPT_ARGS=()   # Stores arguments to pass to the final OS script

# Loop through all arguments passed to this script
while [[ $# -gt 0 ]]; do
  case "$1" in
    --os) # If the argument is --os
      # Check if a value is provided after --os and it's not another flag
      if [[ -n "$2" && ! "$2" =~ ^-- ]]; then
        TARGET_OS_ARG=$(echo "$2" | tr '[:upper:]' '[:lower:]') # Convert OS name to lowercase
        print_info "OS specified via argument: $TARGET_OS_ARG"
        shift # Consume --os argument
        shift # Consume the OS value
      else
        print_error "--os flag requires a value (e.g., --os arch)."
        exit 1
      fi
      ;;
    *)
      # If it's not --os, assume it's an argument for the target OS script
      SCRIPT_ARGS+=("$1")
      shift # Consume the argument
      ;;
  esac
done

# --- Clone or Update Repository ---
# Check if the repository directory already exists
if [ -d "$REPO_DIR_NAME" ]; then
  print_warning "Directory '$REPO_DIR_NAME' already exists."
  # Ask the user if they want to update the existing repository
  read -p "Do you want to pull latest changes? (y/N): " -n 1 -r PULL_CHOICE
  echo # Move to a new line after read
  if [[ $PULL_CHOICE =~ ^[Yy]$ ]]; then
    print_info "Attempting to pull changes in $REPO_DIR_NAME..."
    # Change into the directory safely
    cd "$REPO_DIR_NAME" || { print_error "Could not change directory to $REPO_DIR_NAME."; exit 1; }
    # Try to pull the latest changes
    if git pull; then
      print_success "Repository updated."
    else
      print_error "Failed to pull repository updates. Please check for conflicts or issues."
      # Optional: exit 1 here if a failed pull should stop the script
    fi
    # Change back to the parent directory safely
    cd .. || { print_error "Could not change back to parent directory."; exit 1; }
  else
    print_info "Skipping repository update. Using existing local version."
  fi
else
  # If the directory doesn't exist, clone the repository
  print_info "Cloning repository $REPO_URL into '$REPO_DIR_NAME'..."
  if git clone "$REPO_URL"; then
    print_success "Repository cloned successfully."
  else
    # If cloning fails, print an error and exit
    print_error "Failed to clone repository. Check the URL ($REPO_URL) and network connection."
    exit 1
  fi
fi

# --- Change into Repository Directory ---
print_info "Changing directory to $REPO_DIR_NAME..."
cd "$REPO_DIR_NAME" || { print_error "Failed to enter repository directory '$REPO_DIR_NAME'."; exit 1; }

# --- Determine Target OS ---
FINAL_OS=""         # Will hold the final OS choice (arch, debian, nobara)
DETECTED_OS_ID=""   # OS ID from /etc/os-release
DETECTED_OS_FAMILY="" # OS Family (ID_LIKE or ID) from /etc/os-release

# Function to detect the OS using /etc/os-release
detect_os() {
  if [ -f /etc/os-release ]; then
    # Source the file to get variables like ID, ID_LIKE
    . /etc/os-release
    DETECTED_OS_ID=$ID
    # Use ID_LIKE if it exists, otherwise fallback to ID for family detection
    DETECTED_OS_FAMILY=${ID_LIKE:-$ID}
    print_info "Detected OS ID: $DETECTED_OS_ID, Family: $DETECTED_OS_FAMILY"
  else
    # If the file doesn't exist, we can't auto-detect
    print_warning "/etc/os-release not found. Cannot automatically detect OS."
    return 1 # Indicate failure
  fi

  # Map the detected OS family (lowercase) to the script identifiers
  local family_lower
  family_lower=$(echo "$DETECTED_OS_FAMILY" | tr '[:upper:]' '[:lower:]')

  case "$family_lower" in
    *arch*)        FINAL_OS="arch" ;;
    *debian*|*ubuntu*) FINAL_OS="debian" ;;
    *fedora*|*nobara*) FINAL_OS="nobara" ;; # Handle fedora/nobara family
    *)
      # If the detected OS doesn't match known families
      print_warning "Detected OS Family ('$DETECTED_OS_FAMILY') does not directly match known scripts (arch, debian, nobara)."
      return 1 # Indicate need for manual selection
      ;;
  esac
  return 0 # Indicate successful detection and mapping
}

# Function to prompt the user to select the OS manually
select_os_manually() {
    print_info "Please select the target operating system script:"
    # Use the 'select' command to create a menu
    select os_choice in "Arch/CachyOS (arch.sh)" "Debian/Ubuntu (debian.sh)" "Fedora/Nobara (nobara.sh)" "Cancel"; do
        case $os_choice in
            "Arch/CachyOS (arch.sh)")   FINAL_OS="arch"; break ;;
            "Debian/Ubuntu (debian.sh)") FINAL_OS="debian"; break ;;
            "Fedora/Nobara (nobara.sh)") FINAL_OS="nobara"; break ;;
            "Cancel") echo "Operation cancelled."; exit 0 ;;
            *) echo "Invalid choice. Please try again." ;; # Handle invalid input
        esac
    done
}

# --- OS Determination Logic ---
# Check if the OS was explicitly provided via the --os argument
if [[ -n "$TARGET_OS_ARG" ]]; then
  # Map the provided argument to our script identifiers
  case "$TARGET_OS_ARG" in
      arch|cachyos) FINAL_OS="arch" ;;
      debian|ubuntu) FINAL_OS="debian" ;;
      fedora|nobara) FINAL_OS="nobara" ;;
      *)
          # Handle invalid OS argument
          print_error "Invalid OS specified with --os: $TARGET_OS_ARG. Use 'arch', 'debian', or 'nobara'."
          select_os_manually # Allow manual selection if argument was wrong
          ;;
  esac
else
  # No --os argument was provided, attempt auto-detection
  if detect_os; then
    # Auto-detection successful, confirm with the user
    read -p "Detected OS seems to be '$FINAL_OS'. Is this correct? (Y/n): " -n 1 -r CONFIRM_OS
    echo # Move to a new line after read
    if [[ $CONFIRM_OS =~ ^[Nn]$ ]]; then
      # If the user says no, trigger manual selection
      print_info "Okay, let's select manually."
      select_os_manually
    elif [[ $CONFIRM_OS =~ ^[Yy]$ ]] || [[ -z $CONFIRM_OS ]]; then
      # If the user says yes (or just presses Enter), proceed
      print_info "Proceeding with detected OS: $FINAL_OS"
      # FINAL_OS is already set correctly from detect_os
    else
        # Handle invalid Y/n input
        print_error "Invalid input. Please answer Y or N."
        select_os_manually # Force manual selection on invalid input
    fi
  else
    # Auto-detection failed or OS wasn't mapped, trigger manual selection
    select_os_manually
  fi
fi

# --- Execute Target Script ---
TARGET_SCRIPT_NAME=""
# Determine the exact script filename based on the FINAL_OS choice
case "$FINAL_OS" in
  arch)   TARGET_SCRIPT_NAME="arch.sh" ;;
  debian) TARGET_SCRIPT_NAME="debian.sh" ;;
  nobara) TARGET_SCRIPT_NAME="nobara.sh" ;;
  *)
    # This should ideally not happen if logic above is correct
    print_error "Internal error: Could not determine a valid target script for OS '$FINAL_OS'."
    exit 1
    ;;
esac

# Double-check that an OS was actually selected
if [[ -z "$FINAL_OS" || -z "$TARGET_SCRIPT_NAME" ]]; then
    print_error "No target OS was selected or determined. Exiting."
    exit 1
fi

# Check if the determined target script actually exists in the current directory
if [ -f "./$TARGET_SCRIPT_NAME" ]; then
  print_info "Executing ./$TARGET_SCRIPT_NAME with arguments: ${SCRIPT_ARGS[*]}"
  # Ensure the target script has execute permissions
  chmod +x "./$TARGET_SCRIPT_NAME"

  # Execute the target script using bash, passing along any extra arguments collected earlier
  if bash "./$TARGET_SCRIPT_NAME" "${SCRIPT_ARGS[@]}"; then
    # If the script exits with status 0 (success)
    print_success "$TARGET_SCRIPT_NAME executed successfully."
  else
    # If the script exits with a non-zero status (error)
    print_error "$TARGET_SCRIPT_NAME finished with errors."
    # Optionally exit with the script's error code: exit $?
  fi
else
  # If the target script file is missing
  print_error "Target script './$TARGET_SCRIPT_NAME' not found in the repository directory '$PWD'."
  exit 1
fi

print_info "Bankai script finished."
exit 0
