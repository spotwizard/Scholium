pub(crate) fn normalize_tag_search_value(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn yaml_scalar_without_comment(value: &str) -> &str {
    let mut quote = None;
    let mut previous = None;

    for (index, character) in value.char_indices() {
        if let Some(active_quote) = quote {
            if character == active_quote && previous != Some('\\') {
                quote = None;
            }
        } else if character == '"' || character == '\'' {
            quote = Some(character);
        } else if character == '#' && previous.is_none_or(char::is_whitespace) {
            return value[..index].trim();
        }
        previous = Some(character);
    }

    value.trim()
}

fn parse_yaml_tag_scalar(value: &str) -> String {
    let value = yaml_scalar_without_comment(value).trim();
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        return serde_json::from_str(value).unwrap_or_else(|_| value[1..value.len() - 1].into());
    }
    if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
        return value[1..value.len() - 1].replace("''", "'");
    }
    value.to_string()
}

fn split_yaml_inline_tags(value: &str) -> Vec<String> {
    let value = value.trim().trim_start_matches('[').trim_end_matches(']');
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut previous = None;

    for character in value.chars() {
        if let Some(active_quote) = quote {
            current.push(character);
            if character == active_quote && previous != Some('\\') {
                quote = None;
            }
        } else if character == '"' || character == '\'' {
            quote = Some(character);
            current.push(character);
        } else if character == ',' {
            items.push(parse_yaml_tag_scalar(&current));
            current.clear();
        } else {
            current.push(character);
        }
        previous = Some(character);
    }
    if !current.trim().is_empty() {
        items.push(parse_yaml_tag_scalar(&current));
    }

    items
}

fn unique_markdown_tags(tags: Vec<String>) -> Vec<String> {
    let mut keys = std::collections::HashSet::new();
    tags.into_iter()
        .filter_map(|tag| {
            let tag = tag.split_whitespace().collect::<Vec<_>>().join(" ");
            let key = tag.to_lowercase();
            (!tag.is_empty() && keys.insert(key)).then_some(tag)
        })
        .collect()
}

pub(crate) fn markdown_tags(markdown: &str) -> Vec<String> {
    let normalized = markdown.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next() != Some("---") {
        return Vec::new();
    }

    let mut frontmatter = Vec::new();
    let mut closed = false;
    for line in lines {
        if line.trim() == "---" || line.trim() == "..." {
            closed = true;
            break;
        }
        frontmatter.push(line);
    }
    if !closed {
        return Vec::new();
    }

    for (index, line) in frontmatter.iter().enumerate() {
        let Some(inline_value) = line
            .strip_prefix("tags")
            .and_then(|value| value.trim_start().strip_prefix(':'))
        else {
            continue;
        };
        let inline_value = yaml_scalar_without_comment(inline_value).trim();
        if inline_value.starts_with('[') && inline_value.ends_with(']') {
            return unique_markdown_tags(split_yaml_inline_tags(inline_value));
        }
        if !inline_value.is_empty() {
            return unique_markdown_tags(vec![parse_yaml_tag_scalar(inline_value)]);
        }

        let mut tags = Vec::new();
        for continuation in frontmatter.iter().skip(index + 1) {
            if continuation.trim().is_empty() {
                continue;
            }
            if continuation.trim_start().starts_with('#') {
                continue;
            }
            if !continuation.chars().next().is_some_and(char::is_whitespace) {
                break;
            }
            let continuation = continuation.trim_start();
            let Some(item) = continuation.strip_prefix('-') else {
                break;
            };
            tags.push(parse_yaml_tag_scalar(item.trim_start()));
        }
        return unique_markdown_tags(tags);
    }

    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::markdown_tags;

    #[derive(serde::Deserialize)]
    struct FrontmatterTagFixture {
        name: String,
        markdown: String,
        tags: Vec<String>,
    }

    #[test]
    fn matches_shared_frontmatter_tag_fixtures() {
        let fixtures: Vec<FrontmatterTagFixture> =
            serde_json::from_str(include_str!("../../tests/fixtures/frontmatter-tags.json"))
                .expect("shared frontmatter tag fixtures should be valid JSON");

        for fixture in fixtures {
            assert_eq!(
                markdown_tags(&fixture.markdown),
                fixture.tags,
                "{}",
                fixture.name
            );
        }
    }

    #[test]
    fn ignores_unquoted_frontmatter_comments() {
        assert_eq!(
            markdown_tags("---\ntags: [旅行, \"保留 # 符號\"] # 說明\n---\n內容"),
            vec!["旅行", "保留 # 符號"]
        );
    }

    #[test]
    fn preserves_commas_inside_quoted_tags() {
        assert_eq!(
            markdown_tags("---\ntags: [旅行, \"東京, 大阪\", '台北, 高雄']\n---\n內容"),
            vec!["旅行", "東京, 大阪", "台北, 高雄"]
        );
    }

    #[test]
    fn deduplicates_tags_without_changing_the_first_tags_case() {
        assert_eq!(
            markdown_tags("---\ntags: [Travel, travel, TRAVEL, Other]\n---\n內容"),
            vec!["Travel", "Other"]
        );
    }

    #[test]
    fn rejects_unclosed_frontmatter() {
        assert!(markdown_tags("---\ntags: [旅行]\n內容").is_empty());
    }

    #[test]
    fn returns_no_tags_when_frontmatter_has_no_tags_field() {
        assert!(markdown_tags("---\ntitle: 旅行\n---\n內容").is_empty());
    }
}
