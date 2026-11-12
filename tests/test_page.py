from pipeline.harness.page import book_name, tidy_sections


def test_continuation_chunks_merge_and_titles_lose_their_number():
    texts = ['---\nid: "14.1"\ntitle: "14.1 Introducing ReplicaSets"\npages: 3-4\n---\nFirst part.\n',
             '---\nid: "14.1"\ntitle: Introducing ReplicaSets\n---\nSecond part.\n',
             '---\nid: "14.2"\ntitle: Updating\n---\nNext.\n']
    out = tidy_sections(texts)
    assert [m["id"] for m, _ in out] == ["14.1", "14.2"]
    assert out[0][0] == {"id": "14.1", "title": "Introducing ReplicaSets"}
    assert "First part." in out[0][1] and "Second part." in out[0][1]


def test_book_name_from_an_upload_file_name():
    assert book_name("Kubernetes in Action, Second Edition Deploying (Marko Lukša, Kevin Conner) (z-lib.sk)-493-593.pdf") == "Kubernetes in Action"
    assert book_name("ostep.pdf") == "ostep"
