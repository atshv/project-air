// Test-only C++ parity harness for the contract fixtures.
//
// Reads each fixture file given on the command line with a small self-written
// JSON reader (no third-party library), reduces it to the same canonical line
// as test/parity/canonical.ts and prints one line per fixture. The TypeScript
// unit suite compiles this file with the local C++ compiler and compares both
// output sets. It also includes the generated contract header and instantiates
// the generated model, so a broken header fails the harness.

#include "contract.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace {

struct Json {
  enum class Type { Null, Boolean, Number, String, Array, Object };

  Type type = Type::Null;
  bool boolean = false;
  std::string text;
  std::vector<Json> items;
  std::vector<std::pair<std::string, Json>> members;

  const Json* find(const std::string& key) const {
    for (const auto& member : members) {
      if (member.first == key) return &member.second;
    }
    return nullptr;
  }
};

class JsonReader {
 public:
  explicit JsonReader(std::string text) : text_(std::move(text)) {}

  Json parse() {
    skip();
    Json value = parseValue();
    skip();
    if (position_ != text_.size()) fail("trailing data");
    return value;
  }

 private:
  [[noreturn]] void fail(const std::string& message) const {
    throw std::runtime_error("JSON error at offset " + std::to_string(position_) + ": " + message);
  }

  void skip() {
    while (position_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[position_])) != 0) {
      ++position_;
    }
  }

  char peek() const { return position_ < text_.size() ? text_[position_] : '\0'; }

  void expect(char wanted) {
    if (peek() != wanted) fail(std::string("expected '") + wanted + "'");
    ++position_;
  }

  Json parseValue() {
    skip();
    switch (peek()) {
      case '{':
        return parseObject();
      case '[':
        return parseArray();
      case '"': {
        Json value;
        value.type = Json::Type::String;
        value.text = parseString();
        return value;
      }
      case 't': {
        consumeLiteral("true");
        Json value;
        value.type = Json::Type::Boolean;
        value.boolean = true;
        return value;
      }
      case 'f': {
        consumeLiteral("false");
        Json value;
        value.type = Json::Type::Boolean;
        value.boolean = false;
        return value;
      }
      case 'n':
        consumeLiteral("null");
        return Json{};
      default:
        return parseNumber();
    }
  }

  void consumeLiteral(const char* literal) {
    for (const char* cursor = literal; *cursor != '\0'; ++cursor) {
      if (peek() != *cursor) fail(std::string("expected ") + literal);
      ++position_;
    }
  }

  Json parseObject() {
    expect('{');
    Json value;
    value.type = Json::Type::Object;
    skip();
    if (peek() == '}') {
      ++position_;
      return value;
    }
    for (;;) {
      skip();
      std::string key = parseString();
      skip();
      expect(':');
      value.members.emplace_back(std::move(key), parseValue());
      skip();
      if (peek() == ',') {
        ++position_;
        continue;
      }
      expect('}');
      return value;
    }
  }

  Json parseArray() {
    expect('[');
    Json value;
    value.type = Json::Type::Array;
    skip();
    if (peek() == ']') {
      ++position_;
      return value;
    }
    for (;;) {
      value.items.push_back(parseValue());
      skip();
      if (peek() == ',') {
        ++position_;
        continue;
      }
      expect(']');
      return value;
    }
  }

  std::string parseString() {
    expect('"');
    std::string out;
    while (position_ < text_.size()) {
      const char current = text_[position_++];
      if (current == '"') return out;
      if (current != '\\') {
        out.push_back(current);
        continue;
      }
      if (position_ >= text_.size()) fail("unterminated escape");
      const char escaped = text_[position_++];
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          out.push_back(escaped);
          break;
        case 'b':
          out.push_back('\b');
          break;
        case 'f':
          out.push_back('\f');
          break;
        case 'n':
          out.push_back('\n');
          break;
        case 'r':
          out.push_back('\r');
          break;
        case 't':
          out.push_back('\t');
          break;
        case 'u': {
          unsigned int code = 0;
          for (int digit = 0; digit < 4; ++digit) {
            if (position_ >= text_.size()) fail("unterminated \\u escape");
            const char hex = text_[position_++];
            code <<= 4;
            if (hex >= '0' && hex <= '9') code |= static_cast<unsigned int>(hex - '0');
            else if (hex >= 'a' && hex <= 'f') code |= static_cast<unsigned int>(hex - 'a' + 10);
            else if (hex >= 'A' && hex <= 'F') code |= static_cast<unsigned int>(hex - 'A' + 10);
            else fail("invalid hex digit");
          }
          if (code < 0x80) {
            out.push_back(static_cast<char>(code));
          } else if (code < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (code >> 6)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
          } else {
            out.push_back(static_cast<char>(0xE0 | (code >> 12)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
          }
          break;
        }
        default:
          fail("invalid escape");
      }
    }
    fail("unterminated string");
  }

  Json parseNumber() {
    const std::size_t start = position_;
    if (peek() == '-') ++position_;
    while (position_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[position_])) != 0) {
      ++position_;
    }
    if (peek() == '.') {
      ++position_;
      while (position_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[position_])) != 0) {
        ++position_;
      }
    }
    if (peek() == 'e' || peek() == 'E') {
      ++position_;
      if (peek() == '+' || peek() == '-') ++position_;
      while (position_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[position_])) != 0) {
        ++position_;
      }
    }
    if (position_ == start) fail("unexpected character");
    Json value;
    value.type = Json::Type::Number;
    value.text = text_.substr(start, position_ - start);
    return value;
  }

  std::string text_;
  std::size_t position_ = 0;
};

bool isUuid(const std::string& value) {
  if (value.size() != 36) return false;
  for (std::size_t index = 0; index < value.size(); ++index) {
    const char current = value[index];
    if (index == 8 || index == 13 || index == 18 || index == 23) {
      if (current != '-') return false;
      continue;
    }
    const bool digit = current >= '0' && current <= '9';
    const bool lowercaseHex = current >= 'a' && current <= 'f';
    if (!digit && !lowercaseHex) return false;
  }
  return true;
}

void collectIds(const Json& value, std::set<std::string>& ids) {
  if (value.type == Json::Type::String) {
    if (isUuid(value.text)) ids.insert(value.text);
    return;
  }
  if (value.type == Json::Type::Array) {
    for (const Json& item : value.items) collectIds(item, ids);
    return;
  }
  if (value.type == Json::Type::Object) {
    for (const auto& member : value.members) collectIds(member.second, ids);
  }
}

std::string normalizeSpace(const std::string& text) {
  std::string out;
  bool pendingSpace = false;
  for (const char current : text) {
    if (std::isspace(static_cast<unsigned char>(current)) != 0) {
      pendingSpace = !out.empty();
      continue;
    }
    if (pendingSpace) {
      out.push_back(' ');
      pendingSpace = false;
    }
    out.push_back(current);
  }
  return out;
}

std::string schemaOf(const Json& wrapper) {
  const Json* schema = wrapper.find("schema");
  return schema != nullptr && schema->type == Json::Type::String ? schema->text : std::string();
}

std::string typeOf(const Json& wrapper, const Json& data) {
  if (schemaOf(wrapper) == "schemas/operation.schema.json") {
    const Json* type = data.find("type");
    return type != nullptr && type->type == Json::Type::String ? type->text : std::string("-");
  }
  std::string name = schemaOf(wrapper);
  const std::string prefix = "schemas/";
  if (name.rfind(prefix, 0) == 0) name = name.substr(prefix.size());
  const std::string suffix = ".schema.json";
  if (name.size() > suffix.size() && name.compare(name.size() - suffix.size(), suffix.size(), suffix) == 0) {
    name = name.substr(0, name.size() - suffix.size());
  }
  return name;
}

std::string inverseOf(const Json& data) {
  const Json* inverse = data.find("inverse");
  if (inverse == nullptr || inverse->type != Json::Type::Object) return std::string("-");
  const Json* type = inverse->find("type");
  return type != nullptr && type->type == Json::Type::String ? type->text : std::string("-");
}

std::string join(const std::vector<std::string>& values, const std::string& separator) {
  std::string out;
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index > 0) out += separator;
    out += values[index];
  }
  return out;
}

std::string canonicalLine(const std::string& path, const Json& wrapper) {
  const Json* dataPointer = wrapper.find("data");
  const Json empty;
  const Json& data = dataPointer != nullptr ? *dataPointer : empty;

  const Json* validPointer = wrapper.find("valid");
  const bool valid = validPointer != nullptr && validPointer->type == Json::Type::Boolean && validPointer->boolean;

  const Json* reasonPointer = wrapper.find("reason");
  const std::string reason = normalizeSpace(
      reasonPointer != nullptr && reasonPointer->type == Json::Type::String ? reasonPointer->text : std::string());

  std::vector<std::string> fields;
  if (data.type == Json::Type::Object) {
    for (const auto& member : data.members) fields.push_back(member.first);
    std::sort(fields.begin(), fields.end());
  }

  std::set<std::string> ids;
  collectIds(data, ids);
  const std::vector<std::string> sortedIds(ids.begin(), ids.end());

  return join(
      std::vector<std::string>{
          path,
          schemaOf(wrapper),
          valid ? "true" : "false",
          typeOf(wrapper, data),
          inverseOf(data),
          join(sortedIds, ","),
          join(fields, ","),
          reason,
      },
      "|");
}

std::string readFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  if (!stream) throw std::runtime_error("cannot open " + path);
  std::ostringstream contents;
  contents << stream.rdbuf();
  return contents.str();
}

using project_air::contracts::Operation;
using project_air::contracts::OperationType;

static_assert(std::is_enum_v<OperationType>, "the generated operation type must be an enum");
static_assert(std::is_enum_v<project_air::contracts::BlockType>, "the generated block type must be an enum");

void probeGeneratedModel() {
  Operation operation;
  operation.type = OperationType::group;
  operation.payload = project_air::contracts::GroupPayload{};
  (void)operation;
}

}  // namespace

int main(int argc, char** argv) {
  probeGeneratedModel();
  for (int index = 1; index < argc; ++index) {
    try {
      const std::string path = argv[index];
      const Json wrapper = JsonReader(readFile(path)).parse();
      std::cout << canonicalLine(path, wrapper) << '\n';
    } catch (const std::exception& error) {
      std::cerr << "parity: " << argv[index] << ": " << error.what() << '\n';
      return 1;
    }
  }
  return 0;
}
