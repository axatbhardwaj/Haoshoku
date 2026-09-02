import QtQuick
import QtQml.Models
import org.kde.kdeconnect 1.0

Window {
    property Instantiator commandInstances

    visible: true
    Component.onCompleted: Qt.callLater(function() {
        for (let index = 0; index < commandInstances.count; index += 1) {
            const candidate = commandInstances.objectAt(index);
            if (candidate.name === "Screens Off" && candidate.command === "/usr/bin/hyprctl dispatch 'hl.dsp.dpms({ action = \"disable\" })'") {
                Qt.exit(0);
                return ;
            }
        }
        Qt.exit(42);
    })

    CommandsModel {
        id: commands

        deviceId: "phone123"
    }

    commandInstances: Instantiator {
        model: commands

        delegate: QtObject {
            required property string name
            required property string command
        }

    }

}
