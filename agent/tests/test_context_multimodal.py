from __future__ import annotations

from src.agent.context import ContextBuilder


class _Registry:
    _tools = {}

    def get_definitions(self):
        return []


class _Memory:
    def to_summary(self) -> str:
        return ""


def test_context_builder_adds_image_attachments_to_current_user_message() -> None:
    builder = ContextBuilder(_Registry(), _Memory())

    messages = builder.build_messages(
        "Analyze this chart.",
        image_attachments=[{"data_url": "data:image/jpeg;base64,QUJD", "label": "visible chart"}],
    )

    user_message = messages[-1]
    assert user_message["role"] == "user"
    assert user_message["content"][0] == {"type": "text", "text": "Analyze this chart."}
    assert user_message["content"][1] == {
        "type": "image_url",
        "image_url": {"url": "data:image/jpeg;base64,QUJD"},
    }
