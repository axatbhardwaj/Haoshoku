import logging
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Generator, List

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.logging import RichHandler
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table
from rich.text import Text

log = logging.getLogger("bankai")


class TUI:
    """Manages the Terminal User Interface layout and components."""

    def __init__(self, script_name: str, total_steps: int):
        self.total_steps = total_steps
        self.layout = self._create_layout()
        self.live = Live(self.layout, screen=True, redirect_stderr=False)

        self._output_lines: List[str] = []
        self._step_list: List[str] = []
        self._current_step_index = -1

        self.overall_progress = self._create_overall_progress()
        self.task_progress = self._create_task_progress()
        self.overall_task_id: TaskID | None = None
        self.current_task_id: TaskID | None = None

        self._setup_layout(script_name)

    def _create_layout(self) -> Layout:
        """Defines the TUI layout."""
        layout = Layout(name="root")
        layout.split(
            Layout(name="header", size=3),
            Layout(ratio=1, name="main"),
            Layout(size=1, name="footer"),
        )
        layout["main"].split_row(
            Layout(name="left", ratio=4), Layout(name="right", ratio=1)
        )
        layout["left"].split(Layout(name="output", ratio=3), Layout(name="progress"))
        return layout

    def _create_overall_progress(self) -> Progress:
        """Creates the overall progress bar."""
        return Progress(
            TextColumn("[bold blue]Overall Progress"),
            BarColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeElapsedColumn(),
            transient=False,
        )

    def _create_task_progress(self) -> Progress:
        """Creates the current task progress bar."""
        return Progress(
            SpinnerColumn(),
            TextColumn("[bold cyan]{task.description}"),
            BarColumn(),
            TimeElapsedColumn(),
            transient=True,
        )

    def _setup_layout(self, script_name: str) -> None:
        """Initializes the layout with titles and components."""
        self.layout["header"].update(
            Panel(
                Text(f"Bankai: {script_name} Setup", justify="center"),
                border_style="bold green",
            )
        )
        self.layout["footer"].update(
            Text(f"Bankai v0.1.0 | {datetime.now().year}", justify="right")
        )
        self.layout["output"].update(
            Panel(
                Text("\n" * 20),
                title="[bold yellow]Live Output[/bold yellow]",
                border_style="yellow",
            )
        )
        self.layout["right"].update(
            Panel(
                Text("Initializing...", justify="center"),
                title="[bold magenta]Steps[/bold magenta]",
                border_style="magenta",
            )
        )
        progress_table = Table.grid(expand=True)
        progress_table.add_row(self.overall_progress)
        progress_table.add_row(self.task_progress)
        self.layout["progress"].update(
            Panel(
                progress_table,
                title="[bold blue]Progress[/bold blue]",
                border_style="blue",
            )
        )

    def start(self):
        """Starts the live TUI rendering."""
        self.live.start()
        self.overall_task_id = self.overall_progress.add_task(
            "Total", total=self.total_steps
        )

    def stop(self):
        """Stops the live TUI rendering."""
        if self.overall_task_id is not None:
            self.overall_progress.update(
                self.overall_task_id, completed=self.total_steps
            )
        self.live.stop()

    def update_steps(self, steps: List[str]):
        """Updates the list of steps in the right panel."""
        self._step_list = steps
        self._render_steps()

    def _render_steps(self):
        """Renders the list of steps with the current one highlighted."""
        step_text = []
        for i, step in enumerate(self._step_list):
            if i == self._current_step_index:
                step_text.append(Text(f" ➤ {step}", style="bold cyan"))
            else:
                step_text.append(Text(f"   {step}", style="dim"))
        self.layout["right"].renderable.renderable = Text.from_markup(
            "\n".join(str(s) for s in step_text)
        )

    def log_output(self, message: str):
        """Logs a message to the output panel."""
        self._output_lines.append(message)
        # Keep the output to a manageable size
        if len(self._output_lines) > 20:
            self._output_lines.pop(0)
        self.layout["output"].renderable.renderable = Text(
            "\n".join(self._output_lines), justify="left"
        )

    def skip_task(self, description: str):
        """Skips a task, advancing progress and updating the step list."""
        self._current_step_index += 1
        self._render_steps()
        self.log_output(f"[dim]Skipped: {description}[/dim]")
        if self.overall_task_id is not None:
            self.overall_progress.advance(self.overall_task_id)

    @contextmanager
    def task(self, description: str, total: int = 100) -> Generator[TaskID, None, None]:
        """Context manager for a new task."""
        self._current_step_index += 1
        self._render_steps()
        task_id = self.task_progress.add_task(description, total=total)
        try:
            yield task_id
        finally:
            self.task_progress.update(task_id, completed=total, visible=False)
            if self.overall_task_id is not None:
                self.overall_progress.advance(self.overall_task_id)


def get_tui_logger(tui: TUI):
    """Creates a logger that outputs to the TUI."""

    class TuiHandler(logging.Handler):
        def emit(self, record):
            tui.log_output(self.format(record))

    handler = TuiHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    return handler
