from rag.prompts import build_messages, looks_arabic


def test_looks_arabic_detects_arabic_text():
    assert looks_arabic("ما هي مدة العقد؟")
    assert not looks_arabic("What is the contract term?")


def test_prompt_instructs_arabic_answer_for_arabic_question():
    messages = build_messages("ما هي مدة العقد؟", [])

    assert "Arabic" in messages[0]["content"]
    assert "Modern Standard Arabic" in messages[0]["content"]
